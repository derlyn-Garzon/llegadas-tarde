"""
FastAPI application for Habitual Free Time Analyzer.
"""

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import os
import io
import pandas as pd
from datetime import datetime, timedelta

from app.analysis import parse_appointment_csv, analyze_habitual_free_time

app = FastAPI(title="Calculadora de Tiempos Libres Habituales", version="1.0.0")

# Setup templates
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Render main application home page."""
    return templates.TemplateResponse(request=request, name="index.html")


@app.post("/api/analyze")
async def analyze_csv(
    file: UploadFile = File(...),
    slot_minutes: int = Form(30),
    start_hour: int = Form(8),
    end_hour: int = Form(20),
    min_free_probability: float = Form(0.60)
):
    """
    Endpoint to receive uploaded CSV file, analyze scheduled appointments,
    and return statistical ML model results for habitual free time slots.
    """
    if not file.filename.lower().endswith('.csv'):
        raise HTTPException(status_code=400, detail="El archivo enviado debe ser de formato .csv")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="El archivo CSV está vacío.")

    try:
        df = parse_appointment_csv(content)
        result = analyze_habitual_free_time(
            df=df,
            slot_minutes=slot_minutes,
            start_hour=start_hour,
            end_hour=end_hour,
            min_free_probability=min_free_probability
        )
        return {"status": "success", "data": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/sample-csv")
async def get_sample_csv():
    """
    Generates a realistic sample appointments CSV dataset over 4 weeks
    so the user can immediately test the application.
    """
    sample_rows = []
    base_date = datetime(2025, 3, 3)  # Monday

    # 4 weeks of data
    for week in range(4):
        for day in range(5):  # Mon-Fri
            current_date = base_date + timedelta(weeks=week, days=day)
            date_str = current_date.strftime("%Y-%m-%d")

            # Morning routine appointments: 09:00 - 10:30 on Mon, Wed, Fri
            if day in [0, 2, 4]:
                sample_rows.append({"fecha": date_str, "hora_inicio": "09:00", "hora_fin": "10:30", "titulo": "Reunión de Equipo Sync"})

            # Daily lunch break routine: 13:00 - 14:00
            sample_rows.append({"fecha": date_str, "hora_inicio": "13:00", "hora_fin": "14:00", "titulo": "Almuerzo"})

            # Afternoon client calls: 15:00 - 16:30 on Tue, Thu
            if day in [1, 3]:
                sample_rows.append({"fecha": date_str, "hora_inicio": "15:00", "hora_fin": "16:30", "titulo": "Atención a Clientes"})

            # Late afternoon review: 17:00 - 18:00 Mon, Tue
            if day in [0, 1]:
                sample_rows.append({"fecha": date_str, "hora_inicio": "17:00", "hora_fin": "18:00", "titulo": "Revisión de Proyectos"})

    sample_df = pd.DataFrame(sample_rows)
    output = io.StringIO()
    sample_df.to_csv(output, index=False)

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=citas_ejemplo.csv"}
    )
