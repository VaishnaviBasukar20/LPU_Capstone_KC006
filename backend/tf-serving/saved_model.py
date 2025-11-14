# save_as_savedmodel.py
import os
import tensorflow as tf
from tensorflow.keras.models import load_model # type: ignore
from tensorflow.keras.utils import register_keras_serializable # type: ignore
from tensorflow.keras import layers # type: ignore

# ---- register custom layers so deserialization can find them ----
@register_keras_serializable(package='Custom', name='ChannelMean')
class ChannelMean(layers.Layer):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def call(self, inputs):
        return tf.reduce_mean(inputs, axis=-1, keepdims=True)

    def get_config(self):
        return super().get_config()

@register_keras_serializable(package='Custom', name='ChannelMax')
class ChannelMax(layers.Layer):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def call(self, inputs):
        return tf.reduce_max(inputs, axis=-1, keepdims=True)

    def get_config(self):
        return super().get_config()


MODEL_PATH = r"model/HFACE_Net.keras"                 # your existing .keras file
OUT_DIR = r"model/HFACE_Net_savedmodel"               # directory to create (SavedModel)

# Ensure output folder does not already conflict (optional)
if os.path.exists(OUT_DIR):
    print(f"Warning: output folder '{OUT_DIR}' already exists — it will be overwritten by model.export().")

# Load model (decorators above already register the classes; custom_objects optional)
custom_objs = {"ChannelMean": ChannelMean, "ChannelMax": ChannelMax}
model = load_model(MODEL_PATH, compile=False, custom_objects=custom_objs)
print("✅ Model loaded successfully. Input shape:", model.input_shape)

# Export as TensorFlow SavedModel (Keras 3 API)
# Use model.export to produce a SavedModel directory usable by tf2onnx/tf-serving/tflite.
model.export(OUT_DIR)
print(f"✅ Exported TensorFlow SavedModel to: {OUT_DIR}")

# Quick check: list exported folder contents
print("Export folder contents:", os.listdir(OUT_DIR))
