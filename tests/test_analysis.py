import pytest
import pandas as pd
from app.analysis import parse_appointment_csv, analyze_habitual_free_time


def test_parse_appointment_csv_spanish_cols():
    csv_data = """fecha,hora_inicio,hora_fin
2025-03-03,09:00,10:00
2025-03-03,14:00,15:00
"""
    df = parse_appointment_csv(csv_data)
    assert len(df) == 2
    assert "start_datetime" in df.columns
    assert "end_datetime" in df.columns
    assert str(df.iloc[0]["start_datetime"]) == "2025-03-03 09:00:00"


def test_parse_appointment_csv_english_cols():
    csv_data = """start_datetime,end_datetime
2025-03-03 09:00:00,2025-03-03 10:00:00
2025-03-04 11:00:00,2025-03-04 12:00:00
"""
    df = parse_appointment_csv(csv_data)
    assert len(df) == 2


def test_parse_appointment_csv_invalid():
    with pytest.raises(ValueError):
        parse_appointment_csv("col1,col2\nval1,val2")


def test_analyze_habitual_free_time():
    csv_data = """fecha,hora_inicio,hora_fin
2025-03-03,09:00,10:00
2025-03-10,09:00,10:00
"""
    df = parse_appointment_csv(csv_data)
    results = analyze_habitual_free_time(df, slot_minutes=30, start_hour=8, end_hour=12)

    assert "summary text" not in results
    assert "heatmap" in results
    assert len(results["heatmap"]) == 7
    assert "habitual_blocks" in results
    assert results["summary"]["total_appointments_analyzed"] == 2
