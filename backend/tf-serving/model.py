# benchmark_inference.py
import grpc
import time
import numpy as np
from PIL import Image
import tensorflow as tf
from tensorflow_serving.apis import predict_pb2, prediction_service_pb2_grpc

TF_SERVING_HOST = "localhost:8500"   # change if remote
MODEL_NAME = "hface_net"
SIGNATURE_NAME = "serving_default"
INPUT_KEY = "input_image"
OUTPUT_KEY = "output_0"
TARGET_SIZE = (128, 128)
IMAGE_PATH = "face.png"
LABELS = ['anger','contempt','disgust','fear','happy','neutral','sad','surprise']

def load_and_preprocess(path, target_size=TARGET_SIZE):
    t0 = time.perf_counter()
    img = Image.open(path).convert('RGB').resize(target_size)
    arr = np.asarray(img).astype(np.float32) / 255.0
    arr = np.expand_dims(arr, axis=0)
    t1 = time.perf_counter()
    return arr, (t1 - t0) * 1000.0  # ms preproc time

def do_predict(stub, img_arr, timeout=20.0):
    req = predict_pb2.PredictRequest()
    req.model_spec.name = MODEL_NAME
    req.model_spec.signature_name = SIGNATURE_NAME
    req.inputs[INPUT_KEY].CopyFrom(tf.make_tensor_proto(img_arr, dtype=tf.float32))

    t0 = time.perf_counter()
    resp = stub.Predict(req, timeout=timeout)
    t1 = time.perf_counter()
    grpc_ms = (t1 - t0) * 1000.0
    out_np = tf.make_ndarray(resp.outputs[OUTPUT_KEY])
    return out_np, grpc_ms

def benchmark(image_path, runs=30, warmup=5):
    # reuse channel & stub
    channel = grpc.insecure_channel(TF_SERVING_HOST)
    stub = prediction_service_pb2_grpc.PredictionServiceStub(channel)

    # warmup
    print(f"Warming up with {warmup} requests...")
    for i in range(warmup):
        arr, _ = load_and_preprocess(image_path)
        try:
            _ , t = do_predict(stub, arr)
        except Exception as e:
            print("Warmup call failed:", e)
        time.sleep(0.1)

    preproc_times = []
    grpc_times = []
    total_times = []
    outputs = []

    print(f"Running {runs} timed inferences...")
    for i in range(runs):
        arr, pre_ms = load_and_preprocess(image_path)
        out_np, grpc_ms = do_predict(stub, arr)
        total_ms = pre_ms + grpc_ms

        preproc_times.append(pre_ms)
        grpc_times.append(grpc_ms)
        total_times.append(total_ms)
        outputs.append(out_np)

    # stats
    def stats(x):
        return {
            "mean": float(np.mean(x)),
            "median": float(np.median(x)),
            "p95": float(np.percentile(x, 95)),
            "min": float(np.min(x)),
            "max": float(np.max(x)),
        }

    print("\n=== Preprocessing (ms) ===")
    print(stats(preproc_times))
    print("\n=== gRPC / server roundtrip (ms) ===")
    print(stats(grpc_times))
    print("\n=== Total (ms) ===")
    print(stats(total_times))

    # show last output mapping
    last_out = outputs[-1]
    probs = np.exp(last_out - np.max(last_out, axis=-1, keepdims=True))
    probs = probs / probs.sum(axis=-1, keepdims=True)
    idx = int(np.argmax(probs, axis=1)[0])
    print("\nLast prediction:", LABELS[idx], f"confidence={probs[0, idx]:.2%}")

    return {
        "preproc_ms": preproc_times,
        "grpc_ms": grpc_times,
        "total_ms": total_times,
        "outputs": outputs,
    }

if __name__ == "__main__":
    benchmark("face.png", runs=30, warmup=5)
