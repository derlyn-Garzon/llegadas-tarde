import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_read_main():
    response = client.get("/")
    assert response.status_code == 200
    assert "Detector de Tiempos Libres Habituales" in response.text


def test_get_sample_csv():
    response = client.get("/api/sample-csv")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert "fecha,hora_inicio,hora_fin" in response.text


def test_analyze_endpoint_valid_csv():
    csv_content = b"fecha,hora_inicio,hora_fin\n2025-03-03,09:00,10:00\n2025-03-03,14:00,15:00\n"
    response = client.post(
        "/api/analyze",
        files={"file": ("test.csv", csv_content, "text/csv")},
        data={"slot_minutes": "30", "start_hour": "8", "end_hour": "18", "min_free_probability": "0.6"}
    )
    assert response.status_code == 200
    json_data = response.json()
    assert json_data["status"] == "success"
    assert "heatmap" in json_data["data"]
    assert "habitual_blocks" in json_data["data"]


def test_analyze_endpoint_invalid_file_type():
    response = client.post(
        "/api/analyze",
        files={"file": ("test.txt", b"hello world", "text/plain")}
    )
    assert response.status_code == 400
    assert "El archivo enviado debe ser de formato .csv" in response.json()["detail"]
