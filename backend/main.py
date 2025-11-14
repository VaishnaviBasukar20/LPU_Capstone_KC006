# main.py (updated)
from dotenv import load_dotenv
load_dotenv()

import os
import io
import time
import base64
import asyncio
import logging
from typing import List, Dict, Any, Tuple

import numpy as np
from PIL import Image, UnidentifiedImageError
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import grpc
import tensorflow as tf
from grpc import Compression
from tensorflow_serving.apis import predict_pb2, prediction_service_pb2_grpc
from fastapi.websockets import WebSocketState

# ---------------- CONFIG ----------------
TF_SERVING_HOST = os.getenv("TF_SERVING_HOST", "localhost:8500")
MODEL_NAME = os.getenv("TF_MODEL_NAME", "hface_net")
SIGNATURE_NAME = os.getenv("TF_SIGNATURE_NAME", "serving_default")
INPUT_KEY = os.getenv("TF_INPUT_KEY", "input_image")
OUTPUT_KEY = os.getenv("TF_OUTPUT_KEY", "output_0")
TARGET_SIZE = (128, 128)
MAX_BATCH = int(os.getenv("MAX_BATCH", "8"))
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(300 * 1024)))  # 300 KB per image
USE_COMPRESSION = os.getenv("GRPC_COMPRESSION", "1") != "0"
PREDICT_TIMEOUT = float(os.getenv("PREDICT_TIMEOUT", "10.0"))

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

LABELS = ['anger','contempt','disgust','fear','happy','neutral','sad','surprise']

# ---------------- APP & LOGGING ----------------
app = FastAPI(title="Emotion Feedback API (TensorFlow Serving + Gemini)")

origins = [
    "http://localhost:5173",
    "https://emo-tutor.vercel.app",
    "http://localhost:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,        # list of allowed origins
    allow_credentials=True,
    allow_methods=["*"],          # e.g., GET, POST, PUT, DELETE
    allow_headers=["*"],          # allow all headers (or restrict if needed)
)

logger = logging.getLogger("uvicorn.access")

# gRPC channel/stub will be created per-process in startup
_channel: grpc.Channel | None = None
_stub: Any = None

# ---------------- UTILITIES ----------------
def _create_channel_and_stub():
    # gRPC channel options (tune as needed)
    opts = [
        ('grpc.keepalive_time_ms', 10000),
        ('grpc.keepalive_timeout_ms', 2000),
        ('grpc.http2.max_pings_without_data', 0),
        ('grpc.keepalive_permit_without_calls', 1),
        ('grpc.max_send_message_length', 100 * 1024 * 1024),
        ('grpc.max_receive_message_length', 100 * 1024 * 1024),
    ]
    ch = grpc.insecure_channel(TF_SERVING_HOST, options=opts)
    stub = prediction_service_pb2_grpc.PredictionServiceStub(ch)
    return ch, stub

def load_and_preprocess(img: Image.Image, target_size=TARGET_SIZE) -> Tuple[np.ndarray, float]:
    t0 = time.perf_counter()
    img = img.convert("RGB").resize(target_size, Image.BILINEAR)
    arr = np.asarray(img).astype(np.float32) / 255.0
    arr = np.expand_dims(arr, axis=0)
    t1 = time.perf_counter()
    return arr, (t1 - t0) * 1000.0

def make_batch(files: List[UploadFile]) -> Tuple[np.ndarray, List[float]]:
    arrays, times = [], []
    if len(files) == 0:
        raise HTTPException(status_code=400, detail="No files provided")
    if len(files) > MAX_BATCH:
        raise HTTPException(status_code=400, detail=f"Max {MAX_BATCH} images allowed")
    for f in files:
        content = f.file.read()
        if len(content) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail=f"Image too large (max {MAX_IMAGE_BYTES} bytes)")
        try:
            img = Image.open(io.BytesIO(content))
        except UnidentifiedImageError:
            raise HTTPException(status_code=400, detail="Invalid image")
        arr, t = load_and_preprocess(img)
        arrays.append(arr[0])
        times.append(t)
    batch = np.stack(arrays, axis=0).astype(np.float32)
    return batch, times

def call_tf_serving(batch: np.ndarray, timeout: float = PREDICT_TIMEOUT) -> Tuple[np.ndarray, float]:
    global _stub
    if _stub is None:
        raise RuntimeError("gRPC stub not initialized")
    req = predict_pb2.PredictRequest()
    req.model_spec.name = MODEL_NAME
    req.model_spec.signature_name = SIGNATURE_NAME
    req.inputs[INPUT_KEY].CopyFrom(tf.make_tensor_proto(batch, dtype=tf.float32))

    t0 = time.perf_counter()
    try:
        if USE_COMPRESSION:
            resp = _stub.Predict(req, timeout=timeout, compression=Compression.Gzip)
        else:
            resp = _stub.Predict(req, timeout=timeout)
    except grpc.RpcError as e:
        logger.exception("gRPC Predict failed")
        raise HTTPException(status_code=502, detail=f"TF-Serving error: {e.code().name} - {e.details()}")
    t1 = time.perf_counter()
    out = tf.make_ndarray(resp.outputs[OUTPUT_KEY])
    return out, (t1 - t0) * 1000.0

def softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - np.max(x, axis=-1, keepdims=True))
    return e / np.sum(e, axis=-1, keepdims=True)

def top_k(probs: np.ndarray, k=3) -> List[List[Dict[str, Any]]]:
    out = []
    for row in probs:
        idxs = np.argsort(row)[::-1][:k]
        out.append([{"label": LABELS[i], "confidence": float(row[i])} for i in idxs])
    return out

# ---------------- Gemini (async) ----------------
async def call_gemini_async(prompt: str) -> str:
    if not GEMINI_API_KEY:
        raise RuntimeError("Gemini API key not set")
    headers = {"Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY}
    body = {"contents": [{"parts": [{"text": prompt}] }]}
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(GEMINI_API_URL, headers=headers, json=body)
    if r.status_code != 200:
        raise RuntimeError(f"Gemini error: {r.status_code} {r.text}")
    data = r.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception:
        return str(data)

def build_prompt(context: str, reactions: List[Dict[str, Any]]) -> str:
    formatted = ", ".join([f"{r['label']} ({r['confidence']:.1%})" for r in reactions])
    return (
        f"The meeting is about: {context}\n\n"
        f"This is the current reaction of the participants (top 3): {formatted}.\n\n"
        "Give feedback accordingly and provide suggestions to improve the engagement if needed. "
        "Be concise and give practical advice."
    )

# ---------------- Models ----------------
class EmotionResult(BaseModel):
    label: str
    confidence: float

class ImageResult(BaseModel):
    index: int
    top3: List[EmotionResult]

class ResponseModel(BaseModel):
    images: List[ImageResult]
    top3_aggregate: List[EmotionResult]
    gemini_feedback: str
    timings: Dict[str, float]

# ---------------- Startup / Shutdown ----------------
@app.on_event("startup")
async def startup_event():
    global _channel, _stub
    _channel, _stub = _create_channel_and_stub()
    logger.info("gRPC channel and stub initialized for TF-Serving at %s", TF_SERVING_HOST)

@app.on_event("shutdown")
async def shutdown_event():
    global _channel
    try:
        if _channel:
            _channel.close()
            logger.info("gRPC channel closed")
    except Exception:
        logger.exception("Error closing gRPC channel")

# ---------------- HTTP endpoint ----------------
@app.post("/analyze", response_model=ResponseModel)
async def analyze(context: str = Form(...), files: List[UploadFile] = File(...)):
    if len(files) == 0:
        raise HTTPException(status_code=400, detail="No images provided.")
    if len(files) > MAX_BATCH:
        raise HTTPException(status_code=400, detail=f"Max {MAX_BATCH} images allowed.")
    batch, prep_times = make_batch(files)
    logits, grpc_ms = await asyncio.get_event_loop().run_in_executor(None, call_tf_serving, batch)
    probs = softmax(logits)
    per_image = top_k(probs, 3)
    mean_probs = probs.mean(axis=0, keepdims=True)
    agg_top3 = top_k(mean_probs, 3)[0]

    prompt = build_prompt(context, agg_top3)
    gemini_text = await call_gemini_async(prompt)

    timings = {
        "avg_preproc_ms": float(np.mean(prep_times)),
        "grpc_ms": grpc_ms,
        "total_estimated": float(np.mean(prep_times) + grpc_ms / len(files))
    }

    return {
        "images": [{"index": i, "top3": results} for i, results in enumerate(per_image)],
        "top3_aggregate": agg_top3,
        "gemini_feedback": gemini_text,
        "timings": timings
    }

# ---------------- WebSocket endpoint ----------------
@app.websocket("/ws/analyze")
async def ws_analyze(ws: WebSocket):
    await ws.accept()
    try:
        context_text = ""
        images = {}
        await ws.send_json({"type": "ack", "msg": "connected"})

        while True:
            msg = await ws.receive_json()
            mtype = msg.get("type")
            if mtype == "context":
                context_text = msg.get("context", "")
                await ws.send_json({"type": "ack", "msg": "context_received"})
            elif mtype == "image":
                if len(images) >= MAX_BATCH:
                    await ws.send_json({"type": "error", "msg": "batch full"})
                    continue
                idx = int(msg.get("index", len(images)))
                b64 = msg.get("b64", "")
                try:
                    pil = _b64_to_pil(b64)
                except Exception as e:
                    await ws.send_json({"type": "error", "msg": f"invalid image: {e}"})
                    continue
                images[idx] = pil
                await ws.send_json({"type": "ack", "msg": f"image_{idx}_received", "index": idx, "count": len(images)})
            elif mtype == "done":
                break
            else:
                await ws.send_json({"type": "error", "msg": f"unknown message type: {mtype}"})

        if not images:
            await ws.send_json({"type": "error", "msg": "no images received"})
            await ws.close()
            return

        # Preprocess
        idx_order = sorted(images.keys())
        arrs, pre_ms_list = [], []
        for idx in idx_order:
            arr, ms = load_and_preprocess(images[idx])
            arrs.append(arr[0]); pre_ms_list.append(ms)
        batch = np.stack(arrs, axis=0).astype(np.float32)

        # Call TF Serving (in thread)
        loop = asyncio.get_event_loop()
        logits, grpc_ms = await loop.run_in_executor(None, call_tf_serving, batch)
        probs = softmax(logits)
        per_image_top3 = top_k(probs, k=3)

        # Send partials
        for i, idx in enumerate(idx_order):
            simplified = [{"label": t["label"], "confidence": float(t["confidence"])} for t in per_image_top3[i]]
            await ws.send_json({"type": "partial", "index": idx, "top3": simplified})

        mean_probs = probs.mean(axis=0, keepdims=True)
        agg_top3 = top_k(mean_probs, k=3)[0]
        timings = {"preproc_ms_total": float(np.sum(pre_ms_list)), "avg_preproc_ms_each": float(np.mean(pre_ms_list)), "grpc_ms": float(grpc_ms)}
        await ws.send_json({"type": "aggregate", "top3": agg_top3, "timings": timings})

        # Gemini async
        try:
            gemini_text = await call_gemini_async(build_prompt(context_text or "No context provided", agg_top3))
            await ws.send_json({"type": "gemini", "text": gemini_text})
        except Exception as e:
            await ws.send_json({"type": "error", "msg": f"Gemini failed: {e}"})

        if ws.application_state == WebSocketState.CONNECTED:
            await ws.send_json({"type": "done", "msg": "processing_complete"})
            await ws.close()

    except WebSocketDisconnect:
        logger.info("client disconnected")
    except Exception as e:
        logger.exception("ws error")
        try:
            await ws.send_json({"type": "error", "msg": str(e)})
            await ws.close()
        except:
            pass

# helper for base64 -> PIL
def _b64_to_pil(b64str: str) -> Image.Image:
    if b64str.startswith("data:"):
        b64str = b64str.split(",", 1)[1]
    raw = base64.b64decode(b64str)
    return Image.open(io.BytesIO(raw))

