import numpy as np
from fastapi import FastAPI, File, UploadFile, Form
from PIL import Image
import io
import datetime
import random

app = FastAPI()

# Tactical DB to store the scrying history
patients_db = []

@app.post("/process-scan")
async def process_scan(
    file: UploadFile = File(...), 
    department: str = Form(...), 
    patient_name: str = Form(...)
):
    # 1. READ IMAGE DATA
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    img_array = np.array(image)

    # 2. TACTICAL SEGMENTATION (Simulating InnerEye Logic)
    # We analyze the "bioluminescent" intensity of pixels to find the anomaly
    brightness = np.mean(img_array)
    confidence = round(random.uniform(94.2, 99.8), 2)
    
    # Calculate Volume based on pixel density simulation
    # Simulation: Volume = (Pixel Intensity / Max Intensity) * Scale Factor
    volume_cm3 = round((brightness / 255) * 5.2, 2)

    # 3. SPATIAL MAPPING (X, Y, Z Coordinates)
    # This tells the 3D model exactly where to place the glowing mass
    coord_x = round(random.uniform(-0.5, 0.5), 2)
    coord_y = round(random.uniform(-0.2, 0.6), 2)
    coord_z = round(random.uniform(0.1, 0.7), 2)

    # 4. PATHOLOGY MAPPING
    pathology = "NEOPLASM_DETECTED" if brightness > 100 else "NORMAL_TISSUE"
    if department == "brain":
        prediction = "GLIOMA_SEGMENTED" if brightness > 120 else "STABLE_MIRROR"
    elif department == "heart":
        prediction = "MYOCARDIAL_ANOMALY"
    else:
        prediction = "PULMONARY_LESION"

    # 5. SYNC TO ARCHIVES
    entry = {
        "patient": patient_name,
        "department": department,
        "prediction": prediction,
        "confidence": confidence,
        "volume": f"{volume_cm3} cm³",
        "coords": {"x": coord_x, "y": coord_y, "z": coord_z},
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    }
    patients_db.append(entry)

    return entry

@app.get("/patients")
async def get_patients():
    return {"patients": patients_db}

@app.delete("/clear-history")
async def clear_history():
    patients_db.clear()
    return {"status": "Archives Obliviated"}