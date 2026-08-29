"""
Module for parsing appointment CSV files and normalizing appointment date/times,
plus ML modeling for detecting habitual free time slots.
"""

import io
from datetime import datetime, time, timedelta
import pandas as pd
import numpy as np
from sklearn.neighbors import KernelDensity
from sklearn.ensemble import IsolationForest


WEEKDAYS_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
WEEKDAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def parse_appointment_csv(csv_content: bytes | str) -> pd.DataFrame:
    """
    Parses CSV content containing appointment dates and times into a normalized DataFrame.
    Expected output columns: 'start_datetime', 'end_datetime'
    Supports flexible column headers in English and Spanish.
    """
    if isinstance(csv_content, str):
        csv_file = io.StringIO(csv_content)
    else:
        csv_file = io.BytesIO(csv_content)

    df = pd.read_csv(csv_file)

    # Normalize column names to lowercase stripped strings
    col_map = {c: str(c).strip().lower() for c in df.columns}
    df.rename(columns=col_map, inplace=True)
    cols = set(df.columns)

    start_dt_col = None
    end_dt_col = None

    # Search for unified datetime columns
    for candidate in ['start_datetime', 'start_time', 'inicio_datetime', 'fecha_hora_inicio', 'fecha_hora_inicio_cita']:
        if candidate in cols:
            start_dt_col = candidate
            break

    for candidate in ['end_datetime', 'end_time', 'fin_datetime', 'fecha_hora_fin', 'fecha_hora_fin_cita']:
        if candidate in cols and candidate != start_dt_col:
            end_dt_col = candidate
            break

    # Search for separate date and time columns
    date_col = None
    for candidate in ['date', 'fecha', 'day', 'dia']:
        if candidate in cols:
            date_col = candidate
            break

    start_t_col = None
    for candidate in ['start_time', 'start', 'hora_inicio', 'inicio', 'time_start']:
        if candidate in cols and candidate != start_dt_col:
            start_t_col = candidate
            break

    end_t_col = None
    for candidate in ['end_time', 'end', 'hora_fin', 'fin', 'time_end', 'duracion', 'duration']:
        if candidate in cols and candidate != end_dt_col:
            end_t_col = candidate
            break

    records = []

    if start_dt_col and end_dt_col and start_dt_col != start_t_col:
        # We have direct start and end datetimes
        for idx, row in df.iterrows():
            try:
                s_dt = pd.to_datetime(row[start_dt_col])
                e_dt = pd.to_datetime(row[end_dt_col])
                records.append({'start_datetime': s_dt, 'end_datetime': e_dt})
            except Exception:
                continue
    elif date_col and start_t_col:
        for idx, row in df.iterrows():
            try:
                d_str = str(row[date_col]).split()[0]  # take date part if timestamp
                st_str = str(row[start_t_col])

                # Combine date + start time
                s_dt = pd.to_datetime(f"{d_str} {st_str}")

                if end_t_col and pd.notna(row.get(end_t_col)):
                    et_val = str(row[end_t_col])
                    # If duration in minutes integer
                    if et_val.isdigit():
                        e_dt = s_dt + timedelta(minutes=int(et_val))
                    else:
                        e_dt = pd.to_datetime(f"{d_str} {et_val}")
                        if e_dt <= s_dt:
                            e_dt += timedelta(days=1)
                else:
                    # Default duration: 30 minutes
                    e_dt = s_dt + timedelta(minutes=30)

                records.append({'start_datetime': s_dt, 'end_datetime': e_dt})
            except Exception:
                continue
    else:
        # Try generic datetime parsing on any columns that look like dates/times
        dt_cols = []
        for c in df.columns:
            try:
                parsed = pd.to_datetime(df[c])
                if parsed.notna().sum() > 0.5 * len(df):
                    dt_cols.append(c)
            except Exception:
                pass

        if len(dt_cols) >= 2:
            for idx, row in df.iterrows():
                try:
                    s_dt = pd.to_datetime(row[dt_cols[0]])
                    e_dt = pd.to_datetime(row[dt_cols[1]])
                    records.append({'start_datetime': s_dt, 'end_datetime': e_dt})
                except Exception:
                    continue
        elif len(dt_cols) == 1:
            for idx, row in df.iterrows():
                try:
                    s_dt = pd.to_datetime(row[dt_cols[0]])
                    e_dt = s_dt + timedelta(minutes=30)
                    records.append({'start_datetime': s_dt, 'end_datetime': e_dt})
                except Exception:
                    continue
        else:
            raise ValueError("No se pudieron detectar columnas de fecha y hora válidas en el CSV.")

    result_df = pd.DataFrame(records)
    if result_df.empty:
        raise ValueError("No se obtuvieron registros de citas válidos del archivo CSV.")

    return result_df


def analyze_habitual_free_time(
    df: pd.DataFrame,
    slot_minutes: int = 30,
    start_hour: int = 8,
    end_hour: int = 20,
    min_free_probability: float = 0.60
) -> dict:
    """
    Analyzes appointment DataFrame and calculates habitual free time probabilities using
    empirical frequency combined with Kernel Density Estimation (KDE) and Anomaly Filtering.

    Returns a comprehensive structured result with heatmap matrix, stats, and habitual free time blocks.
    """
    if df.empty:
        raise ValueError("El DataFrame de citas está vacío.")

    # Sort datetimes
    df = df.sort_values('start_datetime').reset_index(drop=True)

    # Anomaly Detection with IsolationForest on appointment durations & times to flag extreme outliers
    if len(df) >= 10:
        durations = (df['end_datetime'] - df['start_datetime']).dt.total_seconds() / 60.0
        start_mins = df['start_datetime'].dt.hour * 60 + df['start_datetime'].dt.minute
        day_of_week = df['start_datetime'].dt.weekday

        features = np.column_stack([day_of_week, start_mins, durations])
        clf = IsolationForest(contamination=0.05, random_state=42)
        preds = clf.fit_predict(features)
        # Keep non-outliers (1) or all if filter leaves too few
        clean_df = df[preds == 1]
        if len(clean_df) >= 5:
            df = clean_df.reset_index(drop=True)

    # Determine date range span in weeks / total occurrences per weekday
    min_date = df['start_datetime'].min().date()
    max_date = df['end_datetime'].max().date()

    # Generate all dates in date range to accurately count total occurrences of each weekday
    all_dates = pd.date_range(start=min_date, end=max_date, freq='D')
    weekday_counts = {w: 0 for w in range(7)}
    for d in all_dates:
        weekday_counts[d.weekday()] += 1

    # Ensure min count of 1 to prevent division by zero
    for w in range(7):
        if weekday_counts[w] == 0:
            weekday_counts[w] = 1

    # Generate time slots array
    time_slots = []
    curr_m = start_hour * 60
    end_m = end_hour * 60
    while curr_m < end_m:
        h = curr_m // 60
        m = curr_m % 60
        time_slots.append(f"{h:02d}:{m:02d}")
        curr_m += slot_minutes

    n_slots = len(time_slots)

    # Create occupancy count matrix: 7 weekdays x n_slots
    occupancy_counts = np.zeros((7, n_slots), dtype=float)

    # We also collect feature points for Kernel Density Estimation model
    kde_points = []

    for _, row in df.iterrows():
        s_dt = row['start_datetime']
        e_dt = row['end_datetime']

        # We step through appointment time range day by day / slot by slot
        cur = s_dt
        while cur < e_dt:
            w = cur.weekday()
            cur_minute = cur.hour * 60 + cur.minute

            # Find slot index
            if start_hour * 60 <= cur_minute < end_hour * 60:
                slot_idx = (cur_minute - start_hour * 60) // slot_minutes
                if 0 <= slot_idx < n_slots:
                    # Collect point for KDE
                    kde_points.append([w, cur_minute])
                    # Increment empirical count for this unique date + weekday + slot
                    # Note: count once per distinct appointment interval
                    occupancy_counts[w, slot_idx] += 1.0

            cur += timedelta(minutes=slot_minutes)

    # Compute empirical occupancy rate P(occupied) = occupied_days / total_weekday_occurrences
    empirical_occ_prob = np.zeros((7, n_slots), dtype=float)
    for w in range(7):
        empirical_occ_prob[w, :] = np.minimum(1.0, occupancy_counts[w, :] / weekday_counts[w])

    # Kernel Density Estimation (KDE) smoothing model if points exist
    kde_prob = np.zeros((7, n_slots), dtype=float)
    if len(kde_points) > 5:
        X_kde = np.array(kde_points)
        # Standardize minute features so KDE distance metric balances day vs minutes
        std_X = X_kde.copy()
        std_X[:, 0] = std_X[:, 0] * 60.0  # weight day of week difference
        kde = KernelDensity(bandwidth=45.0, kernel='gaussian')
        kde.fit(std_X)

        # Evaluate KDE on grid
        grid_points = []
        for w in range(7):
            for slot_idx, slot_str in enumerate(time_slots):
                m_val = start_hour * 60 + slot_idx * slot_minutes
                grid_points.append([w * 60.0, m_val])

        log_dens = kde.score_samples(np.array(grid_points))
        dens = np.exp(log_dens)
        if dens.max() > 0:
            dens_norm = dens / dens.max()
        else:
            dens_norm = dens
        kde_prob = dens_norm.reshape((7, n_slots))

    # Combine empirical frequency (70% weight) and ML KDE density (30% weight) for smooth model probability
    if len(kde_points) > 5:
        occupied_prob = 0.75 * empirical_occ_prob + 0.25 * kde_prob
    else:
        occupied_prob = empirical_occ_prob

    # P(free) = 1.0 - P(occupied)
    free_prob = np.clip(1.0 - occupied_prob, 0.0, 1.0)

    # Construct visual heatmap matrix and identify habitual free time blocks
    heatmap = []
    habitual_blocks = []

    for w in range(7):
        day_name = WEEKDAYS_ES[w]
        day_slots = []

        current_block_start = None
        current_block_probs = []

        for slot_idx, slot_str in enumerate(time_slots):
            p_free = round(float(free_prob[w, slot_idx]), 3)
            p_occ = round(float(occupied_prob[w, slot_idx]), 3)

            # Start/End slot times
            sh = start_hour + (slot_idx * slot_minutes) // 60
            sm = (slot_idx * slot_minutes) % 60
            eh = start_hour + ((slot_idx + 1) * slot_minutes) // 60
            em = ((slot_idx + 1) * slot_minutes) % 60

            slot_time_range = f"{sh:02d}:{sm:02d} - {eh:02d}:{em:02d}"

            day_slots.append({
                "time": slot_str,
                "range": slot_time_range,
                "free_probability": p_free,
                "free_percentage": int(round(p_free * 100)),
                "is_habitual_free": p_free >= min_free_probability
            })

            # Block aggregation logic
            if p_free >= min_free_probability:
                if current_block_start is None:
                    current_block_start = f"{sh:02d}:{sm:02d}"
                current_block_probs.append(p_free)
                block_end = f"{eh:02d}:{em:02d}"
            else:
                if current_block_start is not None:
                    avg_prob = float(np.mean(current_block_probs))
                    habitual_blocks.append({
                        "weekday": day_name,
                        "weekday_idx": w,
                        "start": current_block_start,
                        "end": block_end,
                        "duration_minutes": len(current_block_probs) * slot_minutes,
                        "free_probability": round(avg_prob, 3),
                        "free_percentage": int(round(avg_prob * 100))
                    })
                    current_block_start = None
                    current_block_probs = []

        # Flush block at end of day if open
        if current_block_start is not None:
            avg_prob = float(np.mean(current_block_probs))
            habitual_blocks.append({
                "weekday": day_name,
                "weekday_idx": w,
                "start": current_block_start,
                "end": block_end,
                "duration_minutes": len(current_block_probs) * slot_minutes,
                "free_probability": round(avg_prob, 3),
                "free_percentage": int(round(avg_prob * 100))
            })

        heatmap.append({
            "weekday": day_name,
            "weekday_idx": w,
            "slots": day_slots
        })

    # Sort blocks by free probability (descending) and duration (descending)
    habitual_blocks.sort(key=lambda x: (x['free_probability'], x['duration_minutes']), reverse=True)

    summary_stats = {
        "total_appointments_analyzed": len(df),
        "date_range_start": str(min_date),
        "date_range_end": str(max_date),
        "total_days_spanned": len(all_dates),
        "total_habitual_free_blocks": len(habitual_blocks),
        "overall_free_percentage": int(round(float(free_prob.mean()) * 100))
    }

    return {
        "summary": summary_stats,
        "time_slots": time_slots,
        "heatmap": heatmap,
        "habitual_blocks": habitual_blocks
    }
