import { useEffect, useRef, useState } from "react";
import { hasSupabaseConfig, supabase } from "./lib/supabase";

const STORAGE_KEY = "forge-fitness-tracker-v2";
const THEME_STORAGE_KEY = "forge-theme";
const TIME_ZONE_STORAGE_KEY = "forge-time-zone";
const KG_TO_LB = 2.20462;
const APP_START_DATE = "2026-04-13";
const DEFAULT_PROTEIN_GOAL = 200;
const DEFAULT_TDEE = 3100;
const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh";
const WORKOUT_EXPENDITURE_BONUS = 250;

const EXPENDITURE_CONFIG = {
  trendSmoothing: 0.22,
  rollingIntakeDays: 14,
  comparisonDays: 7,
  damping: 0.24,
  maxDailyMove: 85,
  minEstimate: 1600,
  maxEstimate: 5200,
  fatLossDensitySlow: 9200,
  fatLossDensityFast: 6400,
  gainDensitySlow: 2200,
  gainDensityFast: 7800,
};

const TIME_ZONE_OPTIONS = {
  vietnam: {
    label: "VN",
    timeZone: VIETNAM_TIME_ZONE,
    badge: "GMT+7",
  },
  uk: {
    label: "UK",
    timeZone: "Europe/London",
    badge: "UK",
  },
};

const RANGE_OPTIONS = [
  { key: "7", label: "1W", days: 7 },
  { key: "30", label: "1M", days: 30 },
  { key: "90", label: "3M", days: 90 },
  { key: "180", label: "6M", days: 180 },
  { key: "365", label: "1Y", days: 365 },
  { key: "all", label: "All", days: null },
];

const ACTIVITY_LEVELS = {
  sedentary: {
    label: "Sedentary",
    multiplier: 13,
    summary: "Little exercise",
  },
  light: {
    label: "Lightly active",
    multiplier: 14,
    summary: "1-3 workouts per week",
  },
  moderate: {
    label: "Moderately active",
    multiplier: 15,
    summary: "3-5 workouts per week",
  },
  very: {
    label: "Very active",
    multiplier: 16,
    summary: "6+ hard sessions or a physical job",
  },
};

const GOAL_TYPES = {
  fat_loss: {
    label: "Fat loss",
    direction: "down",
    weeklySweetSpot: "0.5-1.0%",
  },
  maintenance: {
    label: "Maintenance / Recomp",
    direction: "flat",
    weeklySweetSpot: "Hold close to flat",
  },
  muscle_gain: {
    label: "Muscle gain",
    direction: "up",
    weeklySweetSpot: "0.25-0.5%",
  },
};

function toDateInputValue(date) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

function todayString(timeZone = VIETNAM_TIME_ZONE) {
  const actualToday = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return actualToday < APP_START_DATE ? APP_START_DATE : actualToday;
}

function timeLabel(timeZone = VIETNAM_TIME_ZONE) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function loadStoredTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
}

function loadStoredTimeZoneKey() {
  const stored = localStorage.getItem(TIME_ZONE_STORAGE_KEY);
  return TIME_ZONE_OPTIONS[stored] ? stored : "vietnam";
}

function shiftDate(days) {
  const date = parseDate(APP_START_DATE);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function parseDate(value) {
  return new Date(`${value}T12:00:00`);
}

function addDays(value, days) {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function daysBetween(start, end) {
  return (parseDate(end).getTime() - parseDate(start).getTime()) / (1000 * 60 * 60 * 24);
}

function roundToStep(value, step = 25) {
  return Math.round(value / step) * step;
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value, opts) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat(
    "en-US",
    opts ?? { month: "short", day: "numeric", year: "numeric" },
  ).format(parseDate(value));
}

function shortNumber(value, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function signedNumber(value, digits = 0) {
  if (value === null || value === undefined) return "--";
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${shortNumber(numeric, digits)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function interpolateClamped(value, inMin, inMax, outMin, outMax) {
  if (value <= inMin) return outMin;
  if (value >= inMax) return outMax;
  const ratio = (value - inMin) / (inMax - inMin);
  return outMin + ratio * (outMax - outMin);
}

function buildSeedData() {
  return {
    profile: {
      name: "",
      setupComplete: false,
      targetWeight: "",
      targetDate: shiftDate(70),
      programStartDate: "2026-04-15",
      goalType: "fat_loss",
      activityLevel: "moderate",
      calorieGoal: "",
      tdee: DEFAULT_TDEE,
      proteinGoal: DEFAULT_PROTEIN_GOAL,
      workoutGoal: 4,
    },
    weightLogs: [],
    calorieLogs: [],
    workoutLogs: [],
    activityLogs: [],
  };
}

function loadStoredData() {
  const seed = buildSeedData();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return seed;
    }

    const parsed = JSON.parse(raw);
    const storedProfile = parsed.profile || {};

    return {
      profile: {
        ...seed.profile,
        ...storedProfile,
        setupComplete:
          storedProfile.setupComplete ??
          Boolean(
            storedProfile.name ||
              parsed.weightLogs?.length ||
              parsed.calorieLogs?.length ||
              parsed.workoutLogs?.length ||
              parsed.activityLogs?.length,
          ),
        targetWeight:
          storedProfile.targetWeight ??
          storedProfile.weightGoal ??
          seed.profile.targetWeight,
      },
      weightLogs: Array.isArray(parsed.weightLogs) ? parsed.weightLogs : seed.weightLogs,
      calorieLogs: Array.isArray(parsed.calorieLogs) ? parsed.calorieLogs : seed.calorieLogs,
      workoutLogs: Array.isArray(parsed.workoutLogs) ? parsed.workoutLogs : seed.workoutLogs,
      activityLogs: Array.isArray(parsed.activityLogs) ? parsed.activityLogs : seed.activityLogs,
    };
  } catch (error) {
    return seed;
  }
}

function buildAppSnapshot(profile, weightLogs, calorieLogs, workoutLogs, activityLogs) {
  return {
    profile,
    weightLogs,
    calorieLogs,
    workoutLogs,
    activityLogs,
    syncedAt: new Date().toISOString(),
  };
}

function normalizeRemoteSnapshot(payload) {
  const seed = buildSeedData();
  const remote = payload || {};
  const remoteProfile = remote.profile || {};

  return {
    profile: {
      ...seed.profile,
      ...remoteProfile,
      targetWeight:
        remoteProfile.targetWeight ??
        remoteProfile.weightGoal ??
        seed.profile.targetWeight,
    },
    weightLogs: Array.isArray(remote.weightLogs) ? remote.weightLogs : seed.weightLogs,
    calorieLogs: Array.isArray(remote.calorieLogs) ? remote.calorieLogs : seed.calorieLogs,
    workoutLogs: Array.isArray(remote.workoutLogs) ? remote.workoutLogs : seed.workoutLogs,
    activityLogs: Array.isArray(remote.activityLogs) ? remote.activityLogs : seed.activityLogs,
  };
}

function sortByDateDesc(list) {
  return [...list].sort((a, b) => {
    const aKey = `${a.date || ""}-${a.loggedAt || ""}`;
    const bKey = `${b.date || ""}-${b.loggedAt || ""}`;
    return bKey.localeCompare(aKey);
  });
}

function buildTrackedDates(weightLogs, calorieLogs, workoutLogs, activityLogs = [], today = todayString()) {
  return Array.from(
    new Set([today, ...weightLogs, ...calorieLogs, ...workoutLogs, ...activityLogs].map((entry) => entry.date).filter(Boolean)),
  ).sort((a, b) => b.localeCompare(a));
}

function buildHabitCycle(logs, today = todayString()) {
  const cycleLength = 28;
  const elapsed = Math.max(0, Math.floor(daysBetween(APP_START_DATE, today)));
  const cycleStart = addDays(APP_START_DATE, elapsed - (elapsed % cycleLength));
  const loggedDates = new Set(logs.map((entry) => entry.date).filter(Boolean));

  return Array.from({ length: cycleLength }, (_, index) => {
    const date = addDays(cycleStart, index);
    return {
      date,
      isToday: date === today,
      isFuture: date > today,
      isLogged: loggedDates.has(date),
    };
  });
}

function makeDefaultExercises() {
  return [makeExercise("Bench Press"), makeExercise("Incline Dumbbell Press")];
}

function createWeightForm(entry) {
  return {
    id: entry?.id || "",
    date: entry?.date || todayString(),
    weight: entry?.weight !== null && entry?.weight !== undefined ? String(entry.weight) : "",
    bodyFat: entry?.bodyFat !== null && entry?.bodyFat !== undefined ? String(entry.bodyFat) : "",
    note: entry?.note || "",
  };
}

function createCalorieForm(entry, fallbackGoal = "") {
  return {
    id: entry?.id || "",
    date: entry?.date || todayString(),
    calories: entry?.calories !== null && entry?.calories !== undefined ? String(entry.calories) : "",
    goal:
      entry?.goal !== null && entry?.goal !== undefined
        ? String(entry.goal)
        : fallbackGoal !== null && fallbackGoal !== undefined
          ? String(fallbackGoal)
          : "",
    protein: entry?.protein !== null && entry?.protein !== undefined ? String(entry.protein) : "",
    carbs: entry?.carbs !== null && entry?.carbs !== undefined ? String(entry.carbs) : "",
    fats: entry?.fats !== null && entry?.fats !== undefined ? String(entry.fats) : "",
    note: entry?.note || "",
  };
}

function cloneExerciseForForm(exercise) {
  return {
    id: exercise?.id || createId("exercise"),
    name: exercise?.name || "",
    sets:
      exercise?.sets?.length
        ? exercise.sets.map((set) => ({
            id: set?.id || createId("set"),
            reps: set?.reps !== null && set?.reps !== undefined ? String(set.reps) : "",
            weight: set?.weight !== null && set?.weight !== undefined ? String(set.weight) : "",
          }))
        : [makeWorkoutSet("8", ""), makeWorkoutSet("8", ""), makeWorkoutSet("8", "")],
  };
}

function createWorkoutForm(session) {
  return {
    id: session?.id || "",
    date: session?.date || todayString(),
    title: session?.title || "",
    focus: session?.focus || "",
    duration: session?.duration !== null && session?.duration !== undefined ? String(session.duration) : "",
    notes: session?.notes || "",
    exercises: session?.exercises?.length ? session.exercises.map(cloneExerciseForForm) : makeDefaultExercises(),
  };
}

function createRestDayEntry(date, existing) {
  return {
    id: existing?.id || createId("activity"),
    date,
    type: "rest",
    loggedAt: existing?.loggedAt || new Date().toISOString(),
  };
}

function getWorkoutVolume(session) {
  return session.exercises.reduce(
    (sessionTotal, exercise) =>
      sessionTotal +
      exercise.sets.reduce(
        (exerciseTotal, set) => exerciseTotal + (Number(set.reps) || 0) * (Number(set.weight) || 0),
        0,
      ),
    0,
  );
}

function startOfWeek(value) {
  const date = parseDate(value);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return toDateInputValue(date);
}

function buildWeeklyWeightAverages(weightLogs) {
  const weeks = {};

  weightLogs.forEach((entry) => {
    if (!entry.date || !Number.isFinite(Number(entry.weight))) return;
    const weekStart = startOfWeek(entry.date);
    (weeks[weekStart] ??= []).push(Number(entry.weight));
  });

  return Object.entries(weeks)
    .map(([weekStart, values]) => ({
      weekStart,
      count: values.length,
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function buildProgramCheckpointAverages(weightLogs, programStartDate, today) {
  const loggedWeights = weightLogs
    .filter((entry) => entry.date && Number.isFinite(Number(entry.weight)))
    .sort((a, b) => a.date.localeCompare(b.date));
  const elapsedDays = Math.max(0, Math.floor(daysBetween(programStartDate, today)));
  const completedBlocks = Math.floor(elapsedDays / 7);

  return Array.from({ length: completedBlocks }, (_, index) => {
    const start = addDays(programStartDate, index * 7);
    const end = addDays(start, 6);
    const values = loggedWeights
      .filter((entry) => entry.date >= start && entry.date <= end)
      .map((entry) => Number(entry.weight));
    const average = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;

    return {
      index: index + 1,
      start,
      end,
      count: values.length,
      average,
    };
  });
}

function getProgramStartWeight(weightLogs, programStartDate) {
  const exactStart = weightLogs.find(
    (entry) => entry.date === programStartDate && Number.isFinite(Number(entry.weight)),
  );

  if (exactStart) return Number(exactStart.weight);

  const closestBeforeStart = sortByDateDesc(
    weightLogs.filter((entry) => entry.date <= programStartDate && Number.isFinite(Number(entry.weight))),
  )[0];

  return closestBeforeStart ? Number(closestBeforeStart.weight) : null;
}

function buildRollingWeightPoints(weightLogs) {
  const ordered = [...weightLogs]
    .filter((entry) => entry.date && Number.isFinite(Number(entry.weight)))
    .sort((a, b) => a.date.localeCompare(b.date));

  return ordered.map((entry) => {
    const windowStart = addDays(entry.date, -6);
    const values = ordered
      .filter((item) => item.date >= windowStart && item.date <= entry.date)
      .map((item) => Number(item.weight));

    return {
      ...entry,
      sevenDayAverage: values.reduce((total, value) => total + value, 0) / values.length,
    };
  });
}

function buildTrendWeightPoints(weightLogs) {
  const ordered = [...weightLogs]
    .filter((entry) => entry.date && Number.isFinite(Number(entry.weight)))
    .sort((a, b) => a.date.localeCompare(b.date));

  let trendWeight = null;

  return ordered.map((entry, index) => {
    const scaleWeight = Number(entry.weight);
    trendWeight = index === 0 ? scaleWeight : trendWeight + (scaleWeight - trendWeight) * 0.25;

    return {
      ...entry,
      scaleWeight,
      trendWeight,
    };
  });
}

function getLatestTrendWeight(weightLogs) {
  return buildTrendWeightPoints(weightLogs).at(-1)?.trendWeight ?? null;
}

function buildMacroTargets(calories, proteinGoal = DEFAULT_PROTEIN_GOAL) {
  const safeCalories = Number(calories) || 0;
  const protein = Number(proteinGoal) || DEFAULT_PROTEIN_GOAL;
  const proteinCalories = protein * 4;
  const fats = safeCalories ? Math.max(45, roundToStep((safeCalories * 0.25) / 9, 1)) : 0;
  const carbs = safeCalories ? Math.max(0, roundToStep((safeCalories - proteinCalories - fats * 9) / 4, 1)) : 0;

  return {
    calories: safeCalories,
    protein,
    fats,
    carbs,
  };
}

function buildCalendarDates(startDate, endDate) {
  const totalDays = Math.max(0, Math.floor(daysBetween(startDate, endDate)));
  return Array.from({ length: totalDays + 1 }, (_, index) => addDays(startDate, index));
}

function getInitialExpenditureEstimate(profile, weightLogs) {
  const explicitTdee = Number(profile.tdee);
  if (Number.isFinite(explicitTdee) && explicitTdee > 0) return explicitTdee;

  const latestWeight = sortByDateDesc(weightLogs)[0];
  const weight = Number(latestWeight?.weight || profile.targetWeight);
  const bodyFat = Number(latestWeight?.bodyFat);
  const activity = ACTIVITY_LEVELS[profile.activityLevel] || ACTIVITY_LEVELS.moderate;

  if (weight && bodyFat > 0 && bodyFat < 60) {
    const leanBodyMassKg = weight * (1 - bodyFat / 100);
    return roundToStep((500 + 22 * leanBodyMassKg) * (activity.multiplier / 10), 25);
  }

  return weight ? roundToStep(weight * KG_TO_LB * activity.multiplier, 25) : DEFAULT_TDEE;
}

function getRecentActivityEstimate(profile, workoutLogs, activityLogs, date) {
  const windowStart = addDays(date, -27);
  const workoutDates = new Set(
    workoutLogs
      .filter((session) => session.date >= windowStart && session.date <= date)
      .map((session) => session.date),
  );
  const restDates = new Set(
    activityLogs
      .filter(
        (entry) =>
          entry.type === "rest" &&
          entry.date >= windowStart &&
          entry.date <= date &&
          !workoutDates.has(entry.date),
      )
      .map((entry) => entry.date),
  );
  const explicitlyLoggedDates = new Set([...workoutDates, ...restDates]);
  const loggedDays = explicitlyLoggedDates.size;
  const expectedWorkouts = Number(profile.workoutGoal) || 0;
  const workoutsPerWeek = restDates.size && loggedDays ? (workoutDates.size / loggedDays) * 7 : expectedWorkouts;
  const activityModifier = clamp((workoutsPerWeek - expectedWorkouts) * 45, -225, 225);

  return {
    workoutDates,
    restDates,
    loggedDays,
    workoutDays: workoutDates.size,
    restDays: restDates.size,
    workoutsPerWeek,
    activityModifier,
  };
}

function buildTrendWeightByDate(weightLogs, dates, smoothing = EXPENDITURE_CONFIG.trendSmoothing) {
  const weightByDate = new Map(
    weightLogs
      .filter((entry) => entry.date && Number.isFinite(Number(entry.weight)))
      .map((entry) => [entry.date, Number(entry.weight)]),
  );
  let trendWeight = null;
  let lastScaleWeight = null;

  return dates.map((date) => {
    const scaleWeight = weightByDate.get(date) ?? null;

    if (scaleWeight !== null) {
      lastScaleWeight = scaleWeight;
      trendWeight = trendWeight === null ? scaleWeight : trendWeight + (scaleWeight - trendWeight) * smoothing;
    } else if (trendWeight === null && lastScaleWeight !== null) {
      trendWeight = lastScaleWeight;
    }

    return {
      date,
      scaleWeight,
      trendWeight,
    };
  });
}

function inferDailyIntakes(calorieLogs, dates, fallbackCalories) {
  const intakeByDate = new Map(
    calorieLogs
      .filter((entry) => entry.date && Number.isFinite(Number(entry.calories)))
      .map((entry) => [entry.date, Number(entry.calories)]),
  );
  const inferred = [];

  return dates.map((date) => {
    const logged = intakeByDate.get(date);
    const recentLogged = inferred
      .filter((entry) => entry.logged)
      .slice(-EXPENDITURE_CONFIG.rollingIntakeDays)
      .map((entry) => entry.calories);
    const recentAverage = recentLogged.length
      ? recentLogged.reduce((sum, value) => sum + value, 0) / recentLogged.length
      : fallbackCalories;
    const calories = logged ?? recentAverage;
    const row = {
      date,
      calories,
      logged: logged !== undefined,
    };

    inferred.push(row);
    return row;
  });
}

function getEffectiveEnergyDensityKg(weeklyRateKg, bodyWeightKg) {
  if (!weeklyRateKg || !bodyWeightKg) return 7700;

  const weeklyRatePercent = Math.abs(weeklyRateKg) / bodyWeightKg;

  if (weeklyRateKg < 0) {
    // Slower loss is usually a larger proportion fat; fast loss includes more lean tissue/water.
    return interpolateClamped(
      weeklyRatePercent,
      0.0025,
      0.015,
      EXPENDITURE_CONFIG.fatLossDensitySlow,
      EXPENDITURE_CONFIG.fatLossDensityFast,
    );
  }

  // Faster gain is usually a larger proportion fat; slower gain carries lower effective density.
  return interpolateClamped(
    weeklyRatePercent,
    0.0015,
    0.01,
    EXPENDITURE_CONFIG.gainDensitySlow,
    EXPENDITURE_CONFIG.gainDensityFast,
  );
}

function buildExpenditureEstimateSeries(profile, weightLogs, workoutLogs, calorieLogs, activityLogs = [], days = 30, today = todayString()) {
  const allDates = [...weightLogs, ...calorieLogs, ...workoutLogs, ...activityLogs].map((entry) => entry.date).filter(Boolean).sort();
  const startDate = allDates[0] ? addDays(allDates[0], -EXPENDITURE_CONFIG.comparisonDays) : addDays(today, -days + 1);
  const endDate = allDates.at(-1) && allDates.at(-1) > today ? allDates.at(-1) : today;
  const dates = buildCalendarDates(startDate, endDate);
  const baseSeed = getInitialExpenditureEstimate(profile, weightLogs);
  const trendWeights = buildTrendWeightByDate(weightLogs, dates);
  const intakes = inferDailyIntakes(calorieLogs, dates, Number(profile.calorieGoal) || baseSeed);
  const byDate = new Map(trendWeights.map((entry) => [entry.date, entry]));
  let expenditure = baseSeed;

  const estimates = dates.map((date, index) => {
    const activity = getRecentActivityEstimate(profile, workoutLogs, activityLogs, date);
    const base = roundToStep(baseSeed + activity.activityModifier, 25);
    const comparisonDate = addDays(date, -EXPENDITURE_CONFIG.comparisonDays);
    const currentTrend = byDate.get(date)?.trendWeight ?? null;
    const comparisonTrend = byDate.get(comparisonDate)?.trendWeight ?? null;
    const intakeWindow = intakes.slice(Math.max(0, index - EXPENDITURE_CONFIG.rollingIntakeDays + 1), index + 1);
    const averageIntake = intakeWindow.reduce((sum, entry) => sum + entry.calories, 0) / intakeWindow.length;
    const loggedDays = intakeWindow.filter((entry) => entry.logged).length;
    const trendDays =
      currentTrend && comparisonTrend && date !== comparisonDate
        ? EXPENDITURE_CONFIG.comparisonDays
        : 0;
    const trendDeltaKg = trendDays ? currentTrend - comparisonTrend : 0;
    const weeklyRateKg = trendDays ? (trendDeltaKg / trendDays) * 7 : 0;
    const energyDensity = getEffectiveEnergyDensityKg(weeklyRateKg, currentTrend || comparisonTrend || 0);
    const storedEnergyChange = trendDays ? (trendDeltaKg * energyDensity) / trendDays : 0;
    const rawEstimate = trendDays && loggedDays
      ? averageIntake - storedEnergyChange
      : base;
    const cappedRaw = clamp(rawEstimate, expenditure - EXPENDITURE_CONFIG.maxDailyMove, expenditure + EXPENDITURE_CONFIG.maxDailyMove);
    expenditure = clamp(
      expenditure + (cappedRaw - expenditure) * EXPENDITURE_CONFIG.damping,
      EXPENDITURE_CONFIG.minEstimate,
      EXPENDITURE_CONFIG.maxEstimate,
    );

    return {
      id: `expenditure-${date}`,
      date,
      expenditure: roundToStep(expenditure, 25),
      base,
      activityModifier: activity.activityModifier,
      workoutsPerWeek: activity.workoutsPerWeek,
      activityLoggedDays: activity.loggedDays,
      restDays: activity.restDays,
      workoutDays: activity.workoutDays,
      adaptiveExpenditure: trendDays && loggedDays ? roundToStep(rawEstimate, 25) : 0,
      averageIntake,
      inferredIntakeDays: intakeWindow.length - loggedDays,
      loggedIntakeDays: loggedDays,
      trendDeltaKg,
      trendDays,
      weeklyRateKg,
      energyDensity,
      storedEnergyChange,
      hasWorkout: activity.workoutDates.has(date),
      isRestDay: activity.restDates.has(date) && !activity.workoutDates.has(date),
    };
  });

  return estimates.slice(-days);
}

function estimateDailyExpenditure(profile, weightLogs, workoutLogs, calorieLogs, activityLogs = [], date) {
  const series = buildExpenditureEstimateSeries(
    profile,
    weightLogs.filter((entry) => entry.date <= date),
    workoutLogs.filter((entry) => entry.date <= date),
    calorieLogs.filter((entry) => entry.date <= date),
    activityLogs.filter((entry) => entry.date <= date),
    Math.max(14, Math.floor(daysBetween(APP_START_DATE, date)) + 1),
    date,
  );

  return series.find((entry) => entry.date === date) || series.at(-1) || {
    date,
    expenditure: DEFAULT_TDEE,
    base: DEFAULT_TDEE,
    activityModifier: 0,
    workoutsPerWeek: Number(profile.workoutGoal) || 0,
    activityLoggedDays: 0,
    restDays: 0,
    workoutDays: 0,
    adaptiveExpenditure: 0,
    averageIntake: 0,
    inferredIntakeDays: 0,
    loggedIntakeDays: 0,
    trendDeltaKg: 0,
    trendDays: 0,
    weeklyRateKg: 0,
    energyDensity: 7700,
    storedEnergyChange: 0,
    hasWorkout: false,
    isRestDay: false,
  };
}

function buildExpenditureTrend(profile, weightLogs, workoutLogs, calorieLogs, activityLogs = [], days = 30, today = todayString()) {
  return buildExpenditureEstimateSeries(profile, weightLogs, workoutLogs, calorieLogs, activityLogs, days, today);
}

function getRangeDays(rangeKey, logs, today = todayString()) {
  const range = RANGE_OPTIONS.find((option) => option.key === rangeKey) || RANGE_OPTIONS[1];
  if (range.days) return range.days;

  const earliest = logs
    .map((entry) => entry.date)
    .filter(Boolean)
    .sort()[0];

  return earliest ? Math.max(7, Math.floor(daysBetween(earliest, today)) + 1) : 30;
}

function buildRecentCalendarDates(weightLogs, calorieLogs, days = 14, today = todayString()) {
  const allDates = [...weightLogs, ...calorieLogs].map((entry) => entry.date).filter(Boolean);
  const latest = allDates.length ? allDates.sort().at(-1) : today;
  const endDate = latest > today ? latest : today;

  return Array.from({ length: days }, (_, index) => addDays(endDate, index - days + 1));
}

function buildCalorieTrend(profile, weightLogs, calorieLogs, days = 14, today = todayString()) {
  const dates = buildRecentCalendarDates(weightLogs, calorieLogs, days, today);

  return dates.map((date) => {
    const intake = calorieLogs.find((entry) => entry.date === date);
    const weightsThroughDate = weightLogs.filter((entry) => entry.date <= date);
    const caloriesThroughDate = calorieLogs.filter((entry) => entry.date <= date);
    const dayCoach = buildCalorieCoach(profile, weightsThroughDate, caloriesThroughDate, [], [], date);

    return {
      id: `calorie-trend-${date}`,
      date,
      actual: intake ? Number(intake.calories) || null : null,
      recommended:
        dayCoach.recommendedCalories ||
        Number(intake?.goal) ||
        Number(profile.calorieGoal) ||
        null,
    };
  });
}

function buildEnergyBalanceTrend(profile, weightLogs, workoutLogs, calorieLogs, activityLogs = [], days = 30, today = todayString()) {
  return buildRecentCalendarDates(weightLogs, calorieLogs, days, today).map((date) => {
    const intake = calorieLogs.find((entry) => entry.date === date);
    const expenditure = estimateDailyExpenditure(profile, weightLogs, workoutLogs, calorieLogs, activityLogs, date);

    return {
      id: `energy-balance-${date}`,
      date,
      consumed: intake ? Number(intake.calories) || 0 : 0,
      expenditure: expenditure.expenditure || 0,
      difference: (intake ? Number(intake.calories) || 0 : 0) - (expenditure.expenditure || 0),
    };
  });
}

function makeWorkoutSet(reps = "", weight = "") {
  return { id: createId("set"), reps, weight };
}

function makeExercise(name = "") {
  return {
    id: createId("exercise"),
    name,
    sets: [makeWorkoutSet("8", ""), makeWorkoutSet("8", ""), makeWorkoutSet("8", "")],
  };
}

function createSetupState(profile, latestWeight) {
  return {
    name: profile.name || "",
    currentWeight: latestWeight?.weight ? String(latestWeight.weight) : "",
    goalType: profile.goalType || "fat_loss",
    activityLevel: profile.activityLevel || "moderate",
    targetWeight: profile.targetWeight ? String(profile.targetWeight) : "",
    targetDate: profile.targetDate || shiftDate(70),
    workoutGoal: String(profile.workoutGoal || 4),
  };
}

function calculateTrainingDaySplit(target, workoutDays) {
  const days = clamp(Number(workoutDays) || 0, 0, 7);
  const restDays = 7 - days;

  if (days < 2 || days > 5 || restDays === 0) {
    return {
      training: target,
      rest: target,
      enabled: false,
    };
  }

  const spread = 100;
  const restDrop = roundToStep((spread * days) / restDays, 25);

  return {
    training: roundToStep(target + spread, 25),
    rest: roundToStep(target - restDrop, 25),
    enabled: true,
  };
}

function getGoalWeeklyRateKg(profile, currentWeight, today) {
  const goalType = GOAL_TYPES[profile.goalType] ? profile.goalType : "fat_loss";
  const targetWeight = numberOrNull(profile.targetWeight);
  const targetDate = profile.targetDate || "";
  const weeksLeft =
    targetDate && daysBetween(today, targetDate) > 0
      ? daysBetween(today, targetDate) / 7
      : null;

  if (currentWeight && targetWeight !== null && weeksLeft) {
    const required = (targetWeight - currentWeight) / weeksLeft;
    if (goalType === "fat_loss" && required < 0) return required;
    if (goalType === "muscle_gain" && required > 0) return required;
    if (goalType === "maintenance") return required;
  }

  if (!currentWeight) return 0;
  if (goalType === "fat_loss") return -currentWeight * 0.005;
  if (goalType === "muscle_gain") return currentWeight * 0.0025;
  return 0;
}

function getLatestCheckpointDate(profile, today) {
  const start = profile.programStartDate || "2026-04-15";
  const elapsed = Math.max(0, Math.floor(daysBetween(start, today)));
  return addDays(start, elapsed - (elapsed % 7));
}

function buildWeeklyCalorieRecommendation(profile, weightLogs, calorieLogs, workoutLogs, activityLogs, today) {
  const checkpointDate = getLatestCheckpointDate(profile, today);
  const start = profile.programStartDate || "2026-04-15";
  const checkpointCount = Math.max(0, Math.floor(daysBetween(start, checkpointDate) / 7));
  let smoothedTarget = Number(profile.calorieGoal) || 0;
  let latest = null;

  for (let index = 0; index <= checkpointCount; index += 1) {
    const date = addDays(start, index * 7);
    const weightsToDate = weightLogs.filter((entry) => entry.date <= date);
    const caloriesToDate = calorieLogs.filter((entry) => entry.date <= date);
    const workoutsToDate = workoutLogs.filter((entry) => entry.date <= date);
    const activityToDate = activityLogs.filter((entry) => entry.date <= date);
    const trendWeight = getLatestTrendWeight(weightsToDate) || numberOrNull(profile.targetWeight) || 0;
    const expenditure = estimateDailyExpenditure(profile, weightsToDate, workoutsToDate, caloriesToDate, activityToDate, date);
    const goalWeeklyRateKg = getGoalWeeklyRateKg(profile, trendWeight, date);
    const density = getEffectiveEnergyDensityKg(goalWeeklyRateKg, trendWeight || 1);
    const goalOffset = (goalWeeklyRateKg * density) / 7;
    const rawTarget = expenditure.expenditure + goalOffset;

    smoothedTarget = smoothedTarget
      ? smoothedTarget + (rawTarget - smoothedTarget) * 0.35
      : rawTarget;

    latest = {
      checkpointDate: date,
      expenditure,
      goalWeeklyRateKg,
      goalOffset,
      goalDensity: density,
      rawTarget,
      recommendedCalories: roundToStep(smoothedTarget, 25),
    };
  }

  return latest || {
    checkpointDate,
    expenditure: estimateDailyExpenditure(profile, weightLogs, workoutLogs, calorieLogs, activityLogs, today),
    goalWeeklyRateKg: 0,
    goalOffset: 0,
    goalDensity: 7700,
    rawTarget: DEFAULT_TDEE,
    recommendedCalories: DEFAULT_TDEE,
  };
}

function predictWeeklyTrendWeightChange({ intake, expenditure, currentWeight, fallbackRateKg = 0 }) {
  if (!intake || !expenditure || !currentWeight) {
    return {
      weeklyChangeKg: null,
      dailyEnergyBalance: 0,
      energyDensity: getEffectiveEnergyDensityKg(fallbackRateKg, currentWeight || 1),
    };
  }

  const dailyEnergyBalance = intake - expenditure;
  let guessedWeeklyRate = fallbackRateKg;
  let energyDensity = getEffectiveEnergyDensityKg(guessedWeeklyRate, currentWeight);

  // Iterate a few times because tissue density depends on the predicted rate itself.
  for (let index = 0; index < 4; index += 1) {
    guessedWeeklyRate = (dailyEnergyBalance / energyDensity) * 7;
    energyDensity = getEffectiveEnergyDensityKg(guessedWeeklyRate, currentWeight);
  }

  return {
    weeklyChangeKg: guessedWeeklyRate,
    dailyEnergyBalance,
    energyDensity,
  };
}

function buildCalorieCoach(profile, weightLogs, calorieLogs = [], workoutLogs = [], activityLogs = [], todayOverride = todayString()) {
  const sortedWeights = sortByDateDesc(weightLogs);
  const latestWeight = sortedWeights[0];
  const trendWeightPoints = buildTrendWeightPoints(weightLogs);
  const latestTrendWeight = trendWeightPoints.at(-1);
  const currentWeight = latestTrendWeight
    ? Number(latestTrendWeight.trendWeight)
    : latestWeight
      ? Number(latestWeight.weight)
      : numberOrNull(profile.targetWeight);
  const targetWeight = numberOrNull(profile.targetWeight);
  const activity = ACTIVITY_LEVELS[profile.activityLevel] || ACTIVITY_LEVELS.moderate;
  const goalType = GOAL_TYPES[profile.goalType] ? profile.goalType : "fat_loss";
  const weeklyAverages = buildWeeklyWeightAverages(
    trendWeightPoints.map((entry) => ({
      ...entry,
      weight: entry.trendWeight,
    })),
  );
  const lastWeek = weeklyAverages.at(-1) || null;
  const previousWeek = weeklyAverages.at(-2) || null;
  const thirdWeek = weeklyAverages.at(-3) || null;
  const hasReliableTwoWeekTrend =
    !!lastWeek &&
    !!previousWeek &&
    lastWeek.count >= 2 &&
    previousWeek.count >= 2;
  const hasReliableThreeWeekTrend =
    hasReliableTwoWeekTrend &&
    !!thirdWeek &&
    thirdWeek.count >= 2;

  let weeklyTrendKg = null;
  let weeklyTrendPercent = null;

  if (hasReliableTwoWeekTrend) {
    weeklyTrendKg = Number((lastWeek.average - previousWeek.average).toFixed(2));
    weeklyTrendPercent = Number(((weeklyTrendKg / previousWeek.average) * 100).toFixed(2));
  }

  let multiWeekGainKg = weeklyTrendKg;
  let multiWeekGainPercent = weeklyTrendPercent;

  if (hasReliableThreeWeekTrend) {
    multiWeekGainKg = Number((((lastWeek.average - thirdWeek.average) / 2)).toFixed(2));
    multiWeekGainPercent = Number((((multiWeekGainKg / thirdWeek.average) * 100)).toFixed(2));
  }

  const maintenanceCalories = currentWeight
    ? roundToStep(currentWeight * KG_TO_LB * activity.multiplier, 25)
    : 0;

  const today = todayOverride;
  const targetDate = profile.targetDate || "";
  const weeksLeft =
    targetDate && daysBetween(today, targetDate) > 0
      ? Number((daysBetween(today, targetDate) / 7).toFixed(1))
      : null;
  const deltaToGoal =
    currentWeight !== null && targetWeight !== null
      ? Number((targetWeight - currentWeight).toFixed(1))
      : null;
  const requiredKgPerWeek =
    weeksLeft && deltaToGoal !== null
      ? Number((deltaToGoal / weeksLeft).toFixed(2))
      : null;
  const requiredPercentPerWeek =
    currentWeight && requiredKgPerWeek !== null
      ? Number(((Math.abs(requiredKgPerWeek) / currentWeight) * 100).toFixed(2))
      : null;
  const weeklyRecommendation = buildWeeklyCalorieRecommendation(
    profile,
    weightLogs,
    calorieLogs,
    workoutLogs,
    activityLogs,
    today,
  );

  let baseCalories = maintenanceCalories;
  let baseOffsetPercent = 0;
  let baseSummary = "Estimate maintenance first, then adjust from there.";

  if (goalType === "fat_loss") {
    baseOffsetPercent =
      requiredPercentPerWeek !== null
        ? interpolateClamped(requiredPercentPerWeek, 0.5, 1.0, 0.15, 0.25)
        : 0.2;
    baseCalories = roundToStep(maintenanceCalories * (1 - baseOffsetPercent), 25);
    baseSummary =
      requiredPercentPerWeek !== null
        ? `Your target date needs about ${shortNumber(requiredPercentPerWeek, 2)}% bodyweight loss per week, so the baseline uses a ${shortNumber(baseOffsetPercent * 100, 0)}% deficit.`
        : "Defaulting to a moderate 20% deficit because no target-date pace is set yet.";
  } else if (goalType === "maintenance") {
    baseOffsetPercent = 0;
    baseCalories = maintenanceCalories;
    baseSummary =
      "Maintenance stays close to estimated maintenance and uses smaller weekly nudges if weight drifts.";
  } else if (goalType === "muscle_gain") {
    baseOffsetPercent =
      requiredPercentPerWeek !== null
        ? interpolateClamped(requiredPercentPerWeek, 0.25, 0.5, 0.05, 0.15)
        : 0.1;
    baseCalories = roundToStep(maintenanceCalories * (1 + baseOffsetPercent), 25);
    baseSummary =
      requiredPercentPerWeek !== null
        ? `Your target date needs about ${shortNumber(requiredPercentPerWeek, 2)}% bodyweight gain per week, so the baseline uses a ${shortNumber(baseOffsetPercent * 100, 0)}% surplus.`
        : "Defaulting to a moderate 10% surplus because no target-date pace is set yet.";
  }

  let adjustmentCalories = 0;
  let adjustmentTone = "hold";
  let adjustmentSummary =
    "Hold steady until you have enough weekly average data to make a clean change.";
  let observedTrendLabel = "Not enough weekly average data yet.";

  if (goalType === "fat_loss") {
    if (!hasReliableTwoWeekTrend) {
      adjustmentSummary =
        "For fat-loss adjustments, log at least 2 weigh-ins in each of 2 weeks first.";
    } else {
      const weeklyLossPercent = -weeklyTrendPercent;
      observedTrendLabel = `${signedNumber(weeklyTrendKg, 2)} kg per week (${signedNumber(weeklyTrendPercent, 2)}%).`;

      if (weeklyLossPercent < 0.25) {
        adjustmentCalories = -250;
        adjustmentTone = "warn";
        adjustmentSummary =
          "Loss is barely moving, so trim about 250 kcal per day for next week.";
      } else if (weeklyLossPercent < 0.5) {
        adjustmentCalories = -150;
        adjustmentTone = "warn";
        adjustmentSummary =
          "Loss is a bit slower than the 0.5-1.0% zone, so trim about 150 kcal per day.";
      } else if (weeklyLossPercent > 1.5) {
        adjustmentCalories = 250;
        adjustmentTone = "warn";
        adjustmentSummary =
          "Loss is faster than the article's red-flag range, so add about 250 kcal per day.";
      } else if (weeklyLossPercent > 1.0) {
        adjustmentCalories = 150;
        adjustmentTone = "warn";
        adjustmentSummary =
          "Loss is slightly faster than the sweet spot, so add about 150 kcal per day.";
      } else {
        adjustmentTone = "good";
        adjustmentSummary =
          "Weekly loss is inside the 0.5-1.0% sweet spot, so keep calories steady.";
      }
    }
  } else if (goalType === "maintenance") {
    if (!hasReliableTwoWeekTrend) {
      adjustmentSummary =
        "For maintenance, wait until you have 2 weeks of weekly averages before nudging calories.";
    } else {
      observedTrendLabel = `${signedNumber(weeklyTrendKg, 2)} kg per week (${signedNumber(weeklyTrendPercent, 2)}%).`;

      if (weeklyTrendPercent > 0.25) {
        adjustmentCalories = -150;
        adjustmentTone = "warn";
        adjustmentSummary =
          "Weight is drifting upward, so trim about 100-150 kcal per day.";
      } else if (weeklyTrendPercent < -0.25) {
        adjustmentCalories = 150;
        adjustmentTone = "warn";
        adjustmentSummary =
          "Weight is drifting downward, so add about 100-150 kcal per day.";
      } else {
        adjustmentTone = "good";
        adjustmentSummary =
          "Weight is stable enough for maintenance, so hold your current calorie target.";
      }
    }
  } else if (goalType === "muscle_gain") {
    if (!hasReliableThreeWeekTrend) {
      adjustmentSummary =
        "For gaining phases, collect about 3 weeks of weekly averages before changing calories.";
      if (hasReliableTwoWeekTrend) {
        observedTrendLabel = `${signedNumber(weeklyTrendKg, 2)} kg per week (${signedNumber(weeklyTrendPercent, 2)}%).`;
      }
    } else {
      observedTrendLabel = `${signedNumber(multiWeekGainKg, 2)} kg per week (${signedNumber(multiWeekGainPercent, 2)}%) across the last 3 weekly averages.`;

      if (multiWeekGainPercent < 0.1) {
        adjustmentCalories = 250;
        adjustmentTone = "warn";
        adjustmentSummary =
          "Gain is barely moving, so add about 250 kcal per day.";
      } else if (multiWeekGainPercent < 0.25) {
        adjustmentCalories = 150;
        adjustmentTone = "warn";
        adjustmentSummary =
          "Gain is slower than the 0.25-0.5% target zone, so add about 150 kcal per day.";
      } else if (multiWeekGainPercent > 0.75) {
        adjustmentCalories = -250;
        adjustmentTone = "warn";
        adjustmentSummary =
          "Gain is moving too fast, so cut about 250 kcal per day.";
      } else if (multiWeekGainPercent > 0.5) {
        adjustmentCalories = -150;
        adjustmentTone = "warn";
        adjustmentSummary =
          "Gain is slightly too fast, so cut about 150 kcal per day.";
      } else {
        adjustmentTone = "good";
        adjustmentSummary =
          "Weekly gain is inside the 0.25-0.5% sweet spot, so hold your calories.";
      }
    }
  }

  baseCalories = weeklyRecommendation.recommendedCalories;
  baseOffsetPercent = currentWeight
    ? Math.abs((weeklyRecommendation.goalWeeklyRateKg / currentWeight) * 100)
    : 0;
  baseSummary =
    `Checkpoint ${formatDate(weeklyRecommendation.checkpointDate)}: ${shortNumber(weeklyRecommendation.expenditure.expenditure, 0)} kcal DEE plus ${signedNumber(weeklyRecommendation.goalOffset, 0)} kcal/day for your goal rate.`;
  adjustmentCalories = 0;
  adjustmentTone = "hold";
  adjustmentSummary =
    "Recommended calories update only at 7-day checkpoints and are smoothed to avoid jumpy week-to-week changes.";
  observedTrendLabel =
    weeklyRecommendation.goalWeeklyRateKg
      ? `Goal rate: ${signedNumber(weeklyRecommendation.goalWeeklyRateKg, 2)} kg/week using ${shortNumber(weeklyRecommendation.goalDensity, 0)} kcal/kg.`
      : "Maintenance target: hold trend weight steady.";

  const recommendedCalories = maintenanceCalories
    ? weeklyRecommendation.recommendedCalories
    : 0;
  const calorieRangeLow = recommendedCalories
    ? roundToStep(recommendedCalories - 100, 25)
    : 0;
  const calorieRangeHigh = recommendedCalories
    ? roundToStep(recommendedCalories + 100, 25)
    : 0;
  const daySplit = calculateTrainingDaySplit(
    recommendedCalories,
    Number(profile.workoutGoal) || 0,
  );

  const proteinReferenceWeight = targetWeight || currentWeight || 0;
  const proteinLow = proteinReferenceWeight
    ? roundToStep(proteinReferenceWeight * KG_TO_LB * 0.7, 5)
    : 0;
  const proteinHigh = proteinReferenceWeight
    ? roundToStep(proteinReferenceWeight * KG_TO_LB * 1.0, 5)
    : 0;
  const proteinMid = proteinReferenceWeight
    ? roundToStep((proteinLow + proteinHigh) / 2, 5)
    : 0;

  let targetTone = "hold";
  let targetTitle = "Set a target weight and date";
  let targetSummary =
    "A target date lets the app turn your end goal into a weekly pace and calorie baseline.";
  let checkpointDate = "";
  let checkpointWeight = null;
  let projectedDate = "";
  let projectedSummary =
    "Projected finish dates unlock once your weekly averages show a clear trend.";

  if (currentWeight && targetWeight !== null && targetDate) {
    if (daysBetween(today, targetDate) <= 0) {
      targetTone = "danger";
      targetTitle = "Target date has passed";
      targetSummary =
        "Pick a future date so the app can calculate the weekly pace you need.";
    } else if (goalType === "fat_loss" && targetWeight >= currentWeight) {
      targetTone = "warn";
      targetTitle = "Target weight does not match fat-loss mode";
      targetSummary =
        "Fat-loss mode expects a lower target weight than your current trend weight.";
    } else if (goalType === "muscle_gain" && targetWeight <= currentWeight) {
      targetTone = "warn";
      targetTitle = "Target weight does not match gain mode";
      targetSummary =
        "Muscle-gain mode expects a higher target weight than your current trend weight.";
    } else if (goalType === "maintenance" && Math.abs(targetWeight - currentWeight) > 1) {
      targetTone = "warn";
      targetTitle = "Maintenance mode prefers a tighter range";
      targetSummary =
        "A maintenance goal works best when target weight stays close to your current weight.";
    } else if (requiredPercentPerWeek !== null && requiredKgPerWeek !== null) {
      checkpointDate = addDays(today, Math.min(7, Math.max(1, Math.round(weeksLeft * 7))));
      checkpointWeight = Number(
        (currentWeight + requiredKgPerWeek * Math.min(1, weeksLeft)).toFixed(1),
      );

      if (goalType === "fat_loss") {
        if (requiredPercentPerWeek < 0.5) {
          targetTone = "good";
          targetTitle = "Comfortable fat-loss pace";
          targetSummary =
            `You need about ${shortNumber(Math.abs(requiredKgPerWeek), 2)} kg per week, which is gentler than the article's 0.5-1.0% sweet spot.`;
        } else if (requiredPercentPerWeek <= 1.0) {
          targetTone = "good";
          targetTitle = "Target date is in range";
          targetSummary =
            `You need about ${shortNumber(Math.abs(requiredKgPerWeek), 2)} kg per week, which lines up with the article's 0.5-1.0% sweet spot.`;
        } else if (requiredPercentPerWeek <= 1.5) {
          targetTone = "warn";
          targetTitle = "Target date is aggressive";
          targetSummary =
            `You need about ${shortNumber(Math.abs(requiredKgPerWeek), 2)} kg per week, which is above the article's sweet spot and close to the red-flag range.`;
        } else {
          targetTone = "danger";
          targetTitle = "Target date is likely too aggressive";
          targetSummary =
            `You need about ${shortNumber(Math.abs(requiredKgPerWeek), 2)} kg per week, well beyond the article's sustainable range.`;
        }
      } else if (goalType === "muscle_gain") {
        if (requiredPercentPerWeek < 0.25) {
          targetTone = "good";
          targetTitle = "Conservative gain pace";
          targetSummary =
            `You only need about ${shortNumber(Math.abs(requiredKgPerWeek), 2)} kg per week, which is slower than the article's 0.25-0.5% range.`;
        } else if (requiredPercentPerWeek <= 0.5) {
          targetTone = "good";
          targetTitle = "Target date is in range";
          targetSummary =
            `You need about ${shortNumber(Math.abs(requiredKgPerWeek), 2)} kg per week, which lines up with the article's 0.25-0.5% gain range.`;
        } else {
          targetTone = "warn";
          targetTitle = "Target date is aggressive";
          targetSummary =
            `You need about ${shortNumber(Math.abs(requiredKgPerWeek), 2)} kg per week, which is faster than the article's recommended muscle-gain pace.`;
        }
      } else {
        targetTone = "good";
        targetTitle = "Maintenance runway is set";
        targetSummary =
          `You have ${shortNumber(weeksLeft, 1)} weeks to stay near ${shortNumber(targetWeight, 1)} kg while keeping your weekly trend close to flat.`;
      }
    }
  }

  const projectedTrendKg =
    goalType === "muscle_gain" ? multiWeekGainKg : weeklyTrendKg;

  if (
    currentWeight &&
    targetWeight !== null &&
    projectedTrendKg !== null &&
    Math.abs(projectedTrendKg) > 0.01 &&
    Math.sign(targetWeight - currentWeight) === Math.sign(projectedTrendKg)
  ) {
    const weeksNeeded = Math.abs((targetWeight - currentWeight) / projectedTrendKg);
    projectedDate = addDays(today, Math.round(weeksNeeded * 7));
    projectedSummary = !targetDate
      ? `At your current weekly trend, you would arrive around ${formatDate(projectedDate)}.`
      : daysBetween(projectedDate, targetDate) <= 0
        ? `At your current weekly trend, you would arrive around ${formatDate(projectedDate)} and land on or before the target date.`
        : `At your current weekly trend, you would arrive around ${formatDate(projectedDate)}, which is later than the target date.`;
  }

  return {
    maintenanceCalories,
    baseCalories,
    baseOffsetPercent,
    baseSummary,
    recommendationCheckpointDate: weeklyRecommendation.checkpointDate,
    recommendationDee: weeklyRecommendation.expenditure.expenditure,
    recommendationGoalOffset: weeklyRecommendation.goalOffset,
    recommendationGoalRateKg: weeklyRecommendation.goalWeeklyRateKg,
    recommendationGoalDensity: weeklyRecommendation.goalDensity,
    recommendedCalories,
    calorieRangeLow,
    calorieRangeHigh,
    daySplit,
    proteinLow,
    proteinHigh,
    proteinMid,
    weeklyAverages,
    weeklyTrendKg,
    weeklyTrendPercent,
    multiWeekGainKg,
    multiWeekGainPercent,
    observedTrendLabel,
    adjustmentCalories,
    adjustmentTone,
    adjustmentSummary,
    targetTone,
    targetTitle,
    targetSummary,
    checkpointDate,
    checkpointWeight,
    projectedDate,
    projectedSummary,
    weeksLeft,
    deltaToGoal,
    requiredKgPerWeek,
    requiredPercentPerWeek,
    trendWeight: currentWeight,
  };
}

function ProgressRow({ label, value, target, unit, accent = "sage" }) {
  const rawTarget = Number(target) || 0;
  const safeTarget = rawTarget || 1;
  const safeValue = Number(value) || 0;
  const percent = rawTarget === 0 ? 0 : clamp((safeValue / safeTarget) * 100, 0, 100);

  return (
    <div className="progress-row">
      <div className="progress-copy">
        <span>{label}</span>
        <strong>
          {shortNumber(safeValue, unit === "kg" ? 1 : 0)}
          {unit ? ` ${unit}` : ""}
          <span>
            / {shortNumber(rawTarget, unit === "kg" ? 1 : 0)}
            {unit ? ` ${unit}` : ""}
          </span>
        </strong>
      </div>
      <div className="progress-track" aria-hidden="true">
        <div className={`progress-fill ${accent}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function MetricRing({ label, value, target, unit, accent = "sage" }) {
  const safeValue = Number(value) || 0;
  const safeTarget = Number(target) || 0;
  const percent = safeTarget ? clamp((safeValue / safeTarget) * 100, 0, 140) : 0;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const visiblePercent = clamp(percent, 0, 100);
  const dashOffset = circumference - (visiblePercent / 100) * circumference;

  return (
    <div className={`metric-ring ${accent}`}>
      <svg viewBox="0 0 104 104" aria-hidden="true">
        <circle cx="52" cy="52" r={radius} className="ring-track" />
        <circle
          cx="52"
          cy="52"
          r={radius}
          className="ring-value"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div>
        <span>{label}</span>
        <strong>
          {safeValue ? shortNumber(safeValue, unit === "kg" ? 1 : 0) : "--"}
          {unit ? ` ${unit}` : ""}
        </strong>
        <small>{safeTarget ? `${shortNumber(percent, 0)}%` : "--"}</small>
      </div>
    </div>
  );
}

function MacroStrip({ label, value, target, accent }) {
  const safeValue = Number(value) || 0;
  const safeTarget = Number(target) || 0;
  const percent = safeTarget ? clamp((safeValue / safeTarget) * 100, 0, 100) : 0;

  return (
    <div className="macro-strip">
      <span>{label}</span>
      <div className="macro-track">
        <i className={accent} style={{ width: `${percent}%` }} />
      </div>
      <strong>
        {shortNumber(safeValue, 0)} / {safeTarget ? shortNumber(safeTarget, 0) : "--"}g
      </strong>
    </div>
  );
}

function NutritionGauge({ calories, target, protein, carbs, fats }) {
  const safeCalories = Number(calories) || 0;
  const safeTarget = Number(target) || 0;
  const remaining = Math.max(safeTarget - safeCalories, 0);
  const percent = safeTarget ? clamp((safeCalories / safeTarget) * 100, 0, 100) : 0;
  const targets = buildMacroTargets(safeTarget, DEFAULT_PROTEIN_GOAL);
  const radius = 78;
  const circumference = Math.PI * radius;
  const dashOffset = circumference - (percent / 100) * circumference;

  return (
    <div className="nutrition-panel">
      <div className="nutrition-title">
        <h2>Daily Nutrition</h2>
      </div>
      <div className="nutrition-gauge">
        <div className="gauge-side">
          <strong>{shortNumber(remaining, 0)}</strong>
          <span>Remaining</span>
        </div>
        <div className="gauge-core">
          <svg viewBox="0 0 190 112" aria-label="Calories consumed">
            <path d="M 18 94 A 77 77 0 0 1 172 94" className="gauge-track" />
            <path
              d="M 18 94 A 77 77 0 0 1 172 94"
              className="gauge-value"
              pathLength={circumference}
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <div className="gauge-number">
            <strong>{shortNumber(safeCalories, 0)}</strong>
            <span>Consumed</span>
          </div>
        </div>
        <div className="gauge-side">
          <strong>{safeTarget ? shortNumber(safeTarget, 0) : "--"}</strong>
          <span>Target</span>
        </div>
      </div>
      <div className="macro-grid">
        <MacroStrip label="Protein" value={protein} target={targets.protein} accent="protein" />
        <MacroStrip label="Fat" value={fats} target={targets.fats} accent="fat" />
        <MacroStrip label="Carbs" value={carbs} target={targets.carbs} accent="carbs" />
      </div>
      <div className="pill-toggle">
        <span className="active">Consumed</span>
        <span>Remaining</span>
      </div>
    </div>
  );
}

function WeightTrend({ points }) {
  if (points.length < 2) {
    return <div className="empty-state">Need 2 weigh-ins.</div>;
  }

  const ordered = buildRollingWeightPoints(points).sort((a, b) => a.date.localeCompare(b.date));
  const values = ordered.flatMap((point) => [
    Number(point.weight),
    Number(point.sevenDayAverage),
  ]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 320;
  const height = 180;

  const getX = (index) => (index / Math.max(ordered.length - 1, 1)) * width;
  const getY = (value) => height - ((Number(value) - min) / range) * (height - 28) - 14;
  const scaleLine = ordered.map((point, index) => `${getX(index)},${getY(point.weight)}`).join(" ");
  const trendLine = ordered
    .map((point, index) => `${getX(index)},${getY(point.sevenDayAverage)}`)
    .join(" ");
  const latest = ordered.at(-1);

  return (
    <div className="chart-wrap">
      <div className="chart-metrics">
        <div>
          <span>Now</span>
          <strong>{shortNumber(latest.weight, 1)} kg</strong>
        </div>
        <div>
          <span>7d avg</span>
          <strong>{shortNumber(latest.sevenDayAverage, 1)} kg</strong>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="trend-chart" role="img" aria-label="Weight trend">
        <defs>
          <linearGradient id="weightGradient" x1="0" x2="1">
            <stop offset="0%" stopColor="#c8ff5f" />
            <stop offset="100%" stopColor="#64d4ff" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((line) => (
          <line
            key={line}
            x1="0"
            x2={width}
            y1={height * line}
            y2={height * line}
            className="chart-grid-line"
          />
        ))}
        <polyline
          points={scaleLine}
          fill="none"
          className="chart-scale-line"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={trendLine}
          fill="none"
          stroke="url(#weightGradient)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {ordered.map((point, index) => {
          const x = getX(index);
          const y = getY(point.sevenDayAverage);

          return (
            <g key={point.id}>
              <circle cx={x} cy={y} r="5" className="chart-dot" />
              <text
                x={x}
                y={height - 2}
                className="chart-label"
                textAnchor={
                  index === 0 ? "start" : index === ordered.length - 1 ? "end" : "middle"
                }
              >
                {formatDate(point.date, { day: "numeric" })}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span><i className="legend-dot scale" />Scale Weight</span>
        <span><i className="legend-dot actual" />Trend Weight</span>
      </div>
    </div>
  );
}

function CaloriesBars({ entries }) {
  if (!entries.length) {
    return <div className="empty-state">Log calories to compare intake against your target.</div>;
  }

  const ordered = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const maxValue = Math.max(
    ...ordered.map((entry) => Math.max(Number(entry.calories) || 0, Number(entry.goal) || 0)),
    1,
  );

  return (
    <div className="bar-chart">
      {ordered.map((entry) => {
        const caloriesHeight = clamp(((Number(entry.calories) || 0) / maxValue) * 100, 4, 100);
        const goalHeight = clamp(((Number(entry.goal) || 0) / maxValue) * 100, 4, 100);

        return (
          <div className="bar-group" key={entry.id}>
            <div className="bar-stack">
              <div className="bar goal" style={{ height: `${goalHeight}%` }} />
              <div className="bar actual" style={{ height: `${caloriesHeight}%` }} />
            </div>
            <strong>{Number(entry.calories) || 0}</strong>
            <span>{formatDate(entry.date, { month: "short", day: "numeric" })}</span>
          </div>
        );
      })}
    </div>
  );
}

function CalorieTrendChart({ data }) {
  const usable = data.filter((entry) => entry.actual || entry.recommended);

  if (!usable.length) {
    return <div className="empty-state">Need calorie logs.</div>;
  }

  const width = 340;
  const height = 210;
  const chartTop = 16;
  const chartBottom = 34;
  const chartHeight = height - chartTop - chartBottom;
  const maxValue = Math.max(
    ...usable.flatMap((entry) => [Number(entry.actual) || 0, Number(entry.recommended) || 0]),
    1,
  );
  const slot = width / data.length;
  const barWidth = Math.max(9, slot * 0.42);
  const linePoints = data
    .map((entry, index) => {
      if (!entry.actual) return null;
      const x = index * slot + slot / 2;
      const y = chartTop + chartHeight - (entry.actual / maxValue) * chartHeight;
      return `${x},${y}`;
    })
    .filter(Boolean)
    .join(" ");
  const latest = [...data].reverse().find((entry) => entry.actual || entry.recommended);
  const latestActual = latest?.actual || 0;
  const latestRecommended = latest?.recommended || 0;
  const calorieGap = latestActual && latestRecommended ? latestActual - latestRecommended : 0;

  return (
    <div className="chart-wrap calorie-combo">
      <div className="chart-metrics">
        <div>
          <span>Intake</span>
          <strong>{latestActual ? shortNumber(latestActual, 0) : "--"}</strong>
        </div>
        <div>
          <span>Rec</span>
          <strong>{latestRecommended ? shortNumber(latestRecommended, 0) : "--"}</strong>
        </div>
        <div>
          <span>Gap</span>
          <strong>{latestActual && latestRecommended ? signedNumber(calorieGap, 0) : "--"}</strong>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="combo-chart" role="img" aria-label="Calories trend">
        {[0.25, 0.5, 0.75].map((line) => (
          <line
            key={line}
            x1="0"
            x2={width}
            y1={chartTop + chartHeight * line}
            y2={chartTop + chartHeight * line}
            className="chart-grid-line"
          />
        ))}
        {data.map((entry, index) => {
          const recommended = Number(entry.recommended) || 0;
          const x = index * slot + slot / 2 - barWidth / 2;
          const barHeight = recommended ? Math.max(5, (recommended / maxValue) * chartHeight) : 0;
          const y = chartTop + chartHeight - barHeight;

          return (
            <g key={entry.id}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx="5"
                className="recommended-bar"
              />
              <text
                x={index * slot + slot / 2}
                y={height - 7}
                className="chart-label"
                textAnchor="middle"
              >
                {formatDate(entry.date, { day: "numeric" })}
              </text>
            </g>
          );
        })}
        {linePoints ? (
          <polyline
            points={linePoints}
            fill="none"
            className="actual-calorie-line"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {data.map((entry, index) => {
          if (!entry.actual) return null;
          const x = index * slot + slot / 2;
          const y = chartTop + chartHeight - (entry.actual / maxValue) * chartHeight;

          return <circle key={`${entry.id}-actual`} cx={x} cy={y} r="4.5" className="calorie-dot" />;
        })}
      </svg>
      <div className="chart-legend">
        <span><i className="legend-dot recommended" />Recommended</span>
        <span><i className="legend-dot actual" />Actual</span>
      </div>
    </div>
  );
}

function SimpleLineChart({ data, valueKey, className = "simple-line-chart", empty = "Need data." }) {
  const usable = data.filter((entry) => Number.isFinite(Number(entry[valueKey])));

  if (usable.length < 2) {
    return <div className="empty-state">{empty}</div>;
  }

  const width = 320;
  const height = 150;
  const values = usable.map((entry) => Number(entry[valueKey]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const getX = (index) => (index / Math.max(usable.length - 1, 1)) * width;
  const getY = (value) => height - ((value - min) / range) * (height - 24) - 12;
  const points = usable.map((entry, index) => `${getX(index)},${getY(Number(entry[valueKey]))}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label="Trend chart">
      {[0.33, 0.66].map((line) => (
        <line key={line} x1="0" x2={width} y1={height * line} y2={height * line} className="chart-grid-line" />
      ))}
      <polyline points={points} fill="none" className="detail-line" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {usable.map((entry, index) => (
        <circle key={entry.id || entry.date} cx={getX(index)} cy={getY(Number(entry[valueKey]))} r="3.5" className="detail-dot" />
      ))}
      {[usable[0], usable.at(-1)].map((entry, index) => (
        <text
          key={`${entry.date}-${index}`}
          x={index === 0 ? 0 : width}
          y={height - 2}
          className="chart-label"
          textAnchor={index === 0 ? "start" : "end"}
        >
          {formatDate(entry.date, { month: "short", day: "numeric" })}
        </text>
      ))}
    </svg>
  );
}

function ExpenditureDetailChart({ data }) {
  const usable = data.filter((entry) => Number.isFinite(Number(entry.expenditure)));

  if (usable.length < 2) {
    return <div className="empty-state">Need profile data.</div>;
  }

  const width = 320;
  const height = 240;
  const top = 14;
  const bottom = 34;
  const chartHeight = height - top - bottom;
  const values = usable.map((entry) => Number(entry.expenditure));
  const min = Math.min(...values) - 50;
  const max = Math.max(...values) + 50;
  const range = max - min || 1;
  const getX = (index) => (index / Math.max(usable.length - 1, 1)) * width;
  const getY = (value) => top + chartHeight - ((value - min) / range) * chartHeight;
  const linePoints = usable.map((entry, index) => `${getX(index)},${getY(entry.expenditure)}`).join(" ");
  const upperBand = usable
    .map((entry, index) => `${getX(index)},${getY(entry.expenditure + 45)}`)
    .join(" ");
  const lowerBand = [...usable]
    .reverse()
    .map((entry, reverseIndex) => {
      const index = usable.length - 1 - reverseIndex;
      return `${getX(index)},${getY(entry.expenditure - 45)}`;
    })
    .join(" ");
  const bandPoints = `${upperBand} ${lowerBand}`;
  const ticks = [max, (max + min) / 2, min];
  const latest = usable.at(-1);
  const first = usable[0];

  return (
    <div className="expenditure-chart-wrap">
      <div className="expenditure-chart-head">
        <div>
          <span>Latest</span>
          <strong>{shortNumber(latest.expenditure, 0)} kcal</strong>
        </div>
        <div>
          <span>30d Δ</span>
          <strong>{signedNumber(latest.expenditure - first.expenditure, 0)}</strong>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="expenditure-chart" role="img" aria-label="Expenditure trend">
        <defs>
          <linearGradient id="expenditureStroke" x1="0" x2="1">
            <stop offset="0%" stopColor="#ffba8a" />
            <stop offset="100%" stopColor="#f36d45" />
          </linearGradient>
          <linearGradient id="expenditureBand" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(243, 109, 69, 0.22)" />
            <stop offset="100%" stopColor="rgba(243, 109, 69, 0.03)" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1="0" x2={width} y1={getY(tick)} y2={getY(tick)} className="light-grid-line" />
            <text x={width + 4} y={getY(tick) + 4} className="light-axis-label">
              {shortNumber(tick, 0)}
            </text>
          </g>
        ))}
        <polygon points={bandPoints} className="flux-range" />
        <polyline points={linePoints} fill="none" className="expenditure-line" />
        {usable.map((entry, index) => (
          <circle key={entry.id || entry.date} cx={getX(index)} cy={getY(entry.expenditure)} r="3.2" className="expenditure-dot" />
        ))}
        {[usable[0], usable[Math.floor(usable.length * 0.25)], usable[Math.floor(usable.length * 0.5)], usable[Math.floor(usable.length * 0.75)], usable.at(-1)]
          .filter(Boolean)
          .map((entry) => {
            const index = usable.findIndex((item) => item.date === entry.date);
            return (
              <text key={entry.date} x={getX(index)} y={height - 5} className="light-date-label" textAnchor="middle">
                {formatDate(entry.date, { month: "short", day: "numeric" })}
              </text>
            );
          })}
      </svg>
      <div className="light-chart-legend">
        <span><i className="triangle-marker" />Flux Range</span>
        <span><i className="line-marker" />Updating</span>
        <span><i className="line-marker faded" />Holding</span>
      </div>
    </div>
  );
}

function EnergyBalanceChart({ data }) {
  const usable = data.filter((entry) => entry.consumed || entry.expenditure);
  const loggedDays = usable.filter((entry) => entry.consumed);

  if (!usable.length) {
    return <div className="empty-state">Need calorie logs.</div>;
  }

  const width = 340;
  const height = 190;
  const top = 12;
  const bottom = 30;
  const chartHeight = height - top - bottom;
  const maxValue = Math.max(...usable.flatMap((entry) => [entry.consumed, entry.expenditure]), 1);
  const slot = width / usable.length;
  const barWidth = Math.max(5, slot * 0.44);
  const getY = (value) => top + chartHeight - (value / maxValue) * chartHeight;
  const expenditurePoints = usable
    .map((entry, index) => `${index * slot + slot / 2},${getY(entry.expenditure)}`)
    .join(" ");
  const averageConsumed = loggedDays.length
    ? loggedDays.reduce((sum, entry) => sum + (entry.consumed || 0), 0) / loggedDays.length
    : 0;
  const averageExpenditure = loggedDays.length
    ? loggedDays.reduce((sum, entry) => sum + (entry.expenditure || 0), 0) / loggedDays.length
    : 0;

  return (
    <div className="energy-balance-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Energy balance">
        {usable.map((entry, index) => {
          const x = index * slot + slot / 2 - barWidth / 2;
          const barHeight = entry.consumed ? Math.max(4, (entry.consumed / maxValue) * chartHeight) : 0;

          return (
            <rect
              key={entry.id}
              x={x}
              y={top + chartHeight - barHeight}
              width={barWidth}
              height={barHeight}
              rx="2"
              className="balance-bar"
            />
          );
        })}
        <polyline points={expenditurePoints} fill="none" className="balance-target-line" />
      </svg>
      <div className="balance-summary">
        <div>
          <strong>{shortNumber(averageConsumed, 0)}</strong>
          <span>Nutrition</span>
        </div>
        <div>
          <strong>{shortNumber(averageExpenditure, 0)}</strong>
          <span>Expenditure</span>
        </div>
        <div>
          <strong>{signedNumber(averageConsumed - averageExpenditure, 0)}</strong>
          <span>Difference</span>
        </div>
      </div>
      <p className="balance-note">Logged-day avg · {loggedDays.length}/{usable.length} days</p>
    </div>
  );
}

function RangeTabs({ value, onChange }) {
  return (
    <div className="range-tabs" role="tablist" aria-label="Chart range">
      {RANGE_OPTIONS.map((option) => (
        <button
          type="button"
          key={option.key}
          className={value === option.key ? "active" : ""}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function App() {
  const initialData = useRef(null);
  const initialTimeZoneKey = useRef(loadStoredTimeZoneKey());

  if (!initialData.current) {
    initialData.current = loadStoredData();
  }

  const initialLatestWeight = sortByDateDesc(initialData.current.weightLogs)[0];

  const [profile, setProfile] = useState(initialData.current.profile);
  const [weightLogs, setWeightLogs] = useState(initialData.current.weightLogs);
  const [calorieLogs, setCalorieLogs] = useState(initialData.current.calorieLogs);
  const [workoutLogs, setWorkoutLogs] = useState(initialData.current.workoutLogs);
  const [activityLogs, setActivityLogs] = useState(initialData.current.activityLogs || []);
  const [theme, setTheme] = useState(loadStoredTheme);
  const [timeZoneKey, setTimeZoneKey] = useState(initialTimeZoneKey.current);
  const activeTimeZone = TIME_ZONE_OPTIONS[timeZoneKey] || TIME_ZONE_OPTIONS.vietnam;
  const [vietnamToday, setVietnamToday] = useState(() => todayString(activeTimeZone.timeZone));
  const [vietnamTime, setVietnamTime] = useState(() => timeLabel(activeTimeZone.timeZone));
  const [showSetup, setShowSetup] = useState(!initialData.current.profile.setupComplete);
  const [setupError, setSetupError] = useState("");
  const [syncUser, setSyncUser] = useState(null);
  const [syncEmail, setSyncEmail] = useState("");
  const [syncStatus, setSyncStatus] = useState(
    hasSupabaseConfig ? "Sign in to sync across devices." : "Add Supabase keys to enable sync.",
  );
  const [syncBusy, setSyncBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallHint, setShowInstallHint] = useState(false);
  const [setupForm, setSetupForm] = useState(() =>
    createSetupState(initialData.current.profile, initialLatestWeight),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("home");
  const [rangeKey, setRangeKey] = useState("30");
  const [selectedDate, setSelectedDate] = useState(() => todayString(activeTimeZone.timeZone));
  const [composer, setComposer] = useState("daily");
  const [weightForm, setWeightForm] = useState(() => createWeightForm());
  const [calorieForm, setCalorieForm] = useState(() =>
    createCalorieForm(undefined, initialData.current.profile.calorieGoal),
  );
  const [workoutForm, setWorkoutForm] = useState(() => createWorkoutForm());
  const appStateRef = useRef({
    profile,
    weightLogs,
    calorieLogs,
    workoutLogs,
    activityLogs,
  });
  const syncingFromCloudRef = useRef(false);
  const lastSyncedPayloadRef = useRef("");
  const swipeStartXRef = useRef(null);
  const dayCarouselRef = useRef(null);

  useEffect(() => {
    appStateRef.current = {
      profile,
      weightLogs,
      calorieLogs,
      workoutLogs,
      activityLogs,
    };
  }, [profile, weightLogs, calorieLogs, workoutLogs, activityLogs]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profile,
        weightLogs,
        calorieLogs,
        workoutLogs,
        activityLogs,
      }),
    );
  }, [profile, weightLogs, calorieLogs, workoutLogs, activityLogs]);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) return undefined;

    supabase.auth.getSession().then(({ data }) => {
      setSyncUser(data.session?.user ?? null);
      if (data.session?.user) {
        setSyncStatus("Signed in. Pulling your latest cloud data...");
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSyncUser(session?.user ?? null);
      setSyncStatus(
        session?.user ? "Signed in. Sync is ready." : "Sign in to sync across devices.",
      );
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const isiPhone =
      /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
      !window.matchMedia("(display-mode: standalone)").matches;
    setShowInstallHint(isiPhone);

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextToday = todayString(activeTimeZone.timeZone);
      setVietnamTime(timeLabel(activeTimeZone.timeZone));
      setVietnamToday((currentToday) => {
        if (currentToday !== nextToday) {
          setSelectedDate((currentDate) => (currentDate === currentToday ? nextToday : currentDate));
        }
        return nextToday;
      });
    }, 60 * 1000);

    setVietnamToday(todayString(activeTimeZone.timeZone));
    setVietnamTime(timeLabel(activeTimeZone.timeZone));

    return () => window.clearInterval(intervalId);
  }, [activeTimeZone.timeZone]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(TIME_ZONE_STORAGE_KEY, timeZoneKey);
  }, [timeZoneKey]);

  const sortedWeights = sortByDateDesc(weightLogs);
  const sortedCalories = sortByDateDesc(calorieLogs);
  const sortedWorkouts = sortByDateDesc(workoutLogs);
  const sortedActivities = sortByDateDesc(activityLogs);
  const workoutHistoryRows = sortByDateDesc([
    ...workoutLogs.map((session) => ({ ...session, rowType: "workout" })),
    ...activityLogs
      .filter((entry) => !workoutLogs.some((session) => session.date === entry.date))
      .map((entry) => ({ ...entry, rowType: "rest" })),
  ]);
  const rollingWeightPoints = buildRollingWeightPoints(weightLogs);
  const trendWeightPoints = buildTrendWeightPoints(weightLogs);
  const trackedDates = buildTrackedDates(weightLogs, calorieLogs, workoutLogs, activityLogs, vietnamToday);
  const latestWeight = sortedWeights[0];
  const previousWeight = sortedWeights[1];
  const latestWorkout = sortedWorkouts[0];
  const todayWorkout = sortedWorkouts.find((session) => session.date === vietnamToday);
  const todayCalories = sortedCalories.find((entry) => entry.date === vietnamToday);
  const selectedWeight = sortedWeights.find((entry) => entry.date === selectedDate) || null;
  const selectedCalories = sortedCalories.find((entry) => entry.date === selectedDate) || null;
  const selectedWorkouts = sortedWorkouts.filter((session) => session.date === selectedDate);
  const selectedActivity = sortedActivities.find((entry) => entry.date === selectedDate) || null;
  const workoutFormActivity = sortedActivities.find((entry) => entry.date === workoutForm.date) || null;
  const selectedWorkoutVolume = selectedWorkouts.reduce((total, session) => total + getWorkoutVolume(session), 0);
  const selectedWorkoutSets = selectedWorkouts.reduce(
    (total, session) =>
      total + session.exercises.reduce((exerciseTotal, exercise) => exerciseTotal + exercise.sets.length, 0),
    0,
  );
  const recentTrackedDates = trackedDates.slice(0, 14);
  const selectedDateIndex = trackedDates.indexOf(selectedDate);
  const newerDate = selectedDateIndex > 0 ? trackedDates[selectedDateIndex - 1] : null;
  const olderDate =
    selectedDateIndex >= 0 && selectedDateIndex < trackedDates.length - 1
      ? trackedDates[selectedDateIndex + 1]
      : null;
  const thisWeekStart = startOfWeek(vietnamToday);
  const workoutsThisWeek = workoutLogs.filter((session) => session.date >= thisWeekStart);
  const workoutVolumeThisWeek = workoutsThisWeek.reduce((total, session) => total + getWorkoutVolume(session), 0);
  const totalSetsThisWeek = workoutsThisWeek.reduce(
    (total, session) =>
      total + session.exercises.reduce((exerciseTotal, exercise) => exerciseTotal + exercise.sets.length, 0),
    0,
  );
  const averageCalories = sortedCalories.length
    ? sortedCalories
        .slice(0, 7)
        .reduce((total, entry) => total + (Number(entry.calories) || 0), 0) /
      Math.min(sortedCalories.length, 7)
    : 0;
  const activeDays = new Set(
    [...weightLogs, ...calorieLogs, ...workoutLogs, ...activityLogs]
      .map((entry) => entry.date)
      .filter((date) => date && date >= shiftDate(-13)),
  ).size;
  const weightDelta =
    latestWeight && previousWeight ? Number((latestWeight.weight - previousWeight.weight).toFixed(1)) : null;
  const targetWeight = numberOrNull(profile.targetWeight);
  const remainingWeight =
    latestWeight && targetWeight !== null
      ? Number((latestWeight.weight - targetWeight).toFixed(1))
      : null;
  const coach = buildCalorieCoach(profile, weightLogs, calorieLogs, workoutLogs, activityLogs, vietnamToday);
  const trendRangeDays = getRangeDays(rangeKey, [...weightLogs, ...calorieLogs, ...workoutLogs, ...activityLogs], vietnamToday);
  const rangeLabel = RANGE_OPTIONS.find((option) => option.key === rangeKey)?.label || "1M";
  const rangedWeightPoints = sortByDateDesc(weightLogs).slice(0, trendRangeDays).reverse();
  const calorieTrend = buildCalorieTrend(profile, weightLogs, calorieLogs, trendRangeDays, vietnamToday);
  const expenditureTrend = buildExpenditureTrend(profile, weightLogs, workoutLogs, calorieLogs, activityLogs, trendRangeDays, vietnamToday);
  const energyBalanceTrend = buildEnergyBalanceTrend(profile, weightLogs, workoutLogs, calorieLogs, activityLogs, trendRangeDays, vietnamToday);
  const loggedEnergyBalanceDays = energyBalanceTrend.filter((entry) => entry.consumed);
  const loggedEnergyBalanceAverage = loggedEnergyBalanceDays.length
    ? loggedEnergyBalanceDays.reduce((sum, entry) => sum + entry.difference, 0) / loggedEnergyBalanceDays.length
    : 0;
  const rangedAverageCalories = calorieTrend.filter((entry) => entry.actual).length
    ? calorieTrend
        .filter((entry) => entry.actual)
        .reduce((sum, entry) => sum + entry.actual, 0) / calorieTrend.filter((entry) => entry.actual).length
    : 0;
  const selectedExpenditure = estimateDailyExpenditure(profile, weightLogs, workoutLogs, calorieLogs, activityLogs, selectedDate);
  const latestRollingWeight = rollingWeightPoints.at(-1);
  const latestTrendWeight = trendWeightPoints.at(-1);
  const appliedCalorieGoal = Number(profile.calorieGoal) || 0;
  const selectedCalorieTarget = selectedCalories?.goal || Number(profile.calorieGoal) || coach.recommendedCalories || 0;
  const plannedPredictionIntake =
    selectedCalories?.calories ||
    coach.recommendedCalories ||
    appliedCalorieGoal ||
    selectedCalorieTarget;
  const predictedWeightChange = predictWeeklyTrendWeightChange({
    intake: plannedPredictionIntake,
    expenditure: selectedExpenditure.expenditure,
    currentWeight: latestTrendWeight?.trendWeight || latestWeight?.weight || numberOrNull(profile.targetWeight),
    fallbackRateKg: selectedExpenditure.weeklyRateKg,
  });
  const recommendationDelta =
    coach.recommendedCalories && appliedCalorieGoal
      ? coach.recommendedCalories - appliedCalorieGoal
      : 0;
  const macroTargets = buildMacroTargets(selectedCalorieTarget, Number(profile.proteinGoal) || DEFAULT_PROTEIN_GOAL);
  const selectedEnergyDifference = (selectedCalories?.calories || 0) - (selectedExpenditure.expenditure || 0);
  const selectedCalorieDifference = (selectedCalories?.calories || 0) - selectedCalorieTarget;
  const weighInsThisWeek = weightLogs.filter((entry) => entry.date >= thisWeekStart).length;
  const foodLogsThisWeek = calorieLogs.filter((entry) => entry.date >= thisWeekStart).length;
  const workoutsLoggedThisWeek = new Set(
    [...workoutLogs, ...activityLogs].filter((entry) => entry.date >= thisWeekStart).map((entry) => entry.date),
  ).size;
  const macroHabitCycle = buildHabitCycle(calorieLogs, vietnamToday);
  const weighInHabitCycle = buildHabitCycle(weightLogs, vietnamToday);
  const workoutHabitCycle = buildHabitCycle([...workoutLogs, ...activityLogs], vietnamToday);
  const programStartDate = profile.programStartDate || "2026-04-15";
  const programElapsedDays = Math.max(0, Math.floor(daysBetween(programStartDate, vietnamToday)) + 1);
  const completedTrendPeriods = Math.floor(programElapsedDays / 7);
  const daysToTrendCheck = programElapsedDays > 0 ? (7 - (programElapsedDays % 7)) % 7 : 0;
  const nextTrendCheckDate = addDays(vietnamToday, daysToTrendCheck);
  const trendCheckDue = programElapsedDays >= 7 && daysToTrendCheck === 0;
  const checkpointAverages = buildProgramCheckpointAverages(weightLogs, programStartDate, vietnamToday);
  const latestCheckpointAverage = checkpointAverages.at(-1);
  const previousCheckpointAverage = checkpointAverages.at(-2);
  const programStartWeight = getProgramStartWeight(weightLogs, programStartDate);
  const lastCheckpointChange =
    latestCheckpointAverage?.average !== null &&
    latestCheckpointAverage?.average !== undefined
      ? previousCheckpointAverage?.average !== null &&
        previousCheckpointAverage?.average !== undefined
        ? latestCheckpointAverage.average - previousCheckpointAverage.average
        : programStartWeight !== null
          ? latestCheckpointAverage.average - programStartWeight
          : null
      : null;
  const topCards = [
    {
      title: "Weight Trend",
      value: latestWeight ? `${shortNumber(latestWeight.weight, 1)} kg` : "--",
      subtitle: "Last 7 Days",
      tone: "purple",
      action: () => jumpToSection("weightDetail"),
    },
    {
      title: "Expenditure",
      value: selectedExpenditure.expenditure ? `${shortNumber(selectedExpenditure.expenditure, 0)} kcal` : "--",
      subtitle: "Trend adjusted",
      tone: "blue",
      action: () => jumpToSection("expenditureDetail"),
    },
    {
      title: "Energy Balance",
      value: selectedExpenditure.expenditure && selectedCalories ? signedNumber(selectedEnergyDifference, 0) : "--",
      subtitle: "Consumed vs spent",
      tone: "orange",
      action: () => jumpToSection("energyBalanceDetail"),
    },
    {
      title: "Calories Balance",
      value: selectedCalories ? signedNumber(selectedCalorieDifference, 0) : "--",
      subtitle: "Target vs actual",
      tone: "green",
      action: () => jumpToSection("calorieDetail"),
    },
  ];
  const syncConfigured = hasSupabaseConfig && Boolean(supabase);

  const applyRemoteSnapshot = (payload) => {
    const normalized = normalizeRemoteSnapshot(payload);
    syncingFromCloudRef.current = true;
    setProfile(normalized.profile);
    setWeightLogs(normalized.weightLogs);
    setCalorieLogs(normalized.calorieLogs);
    setWorkoutLogs(normalized.workoutLogs);
    setActivityLogs(normalized.activityLogs);
    setSetupForm(createSetupState(normalized.profile, sortByDateDesc(normalized.weightLogs)[0]));
    setWeightForm(createWeightForm());
    setCalorieForm(createCalorieForm(undefined, normalized.profile.calorieGoal || ""));
    setWorkoutForm(createWorkoutForm());
    setSelectedDate(vietnamToday);
  };

  const pullFromCloud = async () => {
    if (!syncConfigured || !syncUser) return;

    setSyncBusy(true);
    setSyncStatus("Pulling latest cloud data...");

    const { data, error } = await supabase
      .from("app_snapshots")
      .select("payload, updated_at")
      .eq("user_id", syncUser.id)
      .maybeSingle();

    setSyncBusy(false);

    if (error) {
      setSyncStatus("Could not pull sync data. Check Supabase setup.");
      return;
    }

    if (data?.payload) {
      applyRemoteSnapshot(data.payload);
      lastSyncedPayloadRef.current = JSON.stringify(normalizeRemoteSnapshot(data.payload));
      setSyncStatus(`Cloud data loaded at ${new Date().toLocaleTimeString()}.`);
    } else {
      setSyncStatus("No cloud snapshot yet. Your first save will create one.");
    }
  };

  const pushToCloud = async () => {
    if (!syncConfigured || !syncUser) return;

    const snapshot = buildAppSnapshot(
      appStateRef.current.profile,
      appStateRef.current.weightLogs,
      appStateRef.current.calorieLogs,
      appStateRef.current.workoutLogs,
      appStateRef.current.activityLogs,
    );

    setSyncBusy(true);
    setSyncStatus("Saving to cloud...");

    const { error } = await supabase.from("app_snapshots").upsert(
      {
        user_id: syncUser.id,
        payload: snapshot,
        updated_at: snapshot.syncedAt,
      },
      { onConflict: "user_id" },
    );

    setSyncBusy(false);

    if (error) {
      setSyncStatus("Cloud save failed. Check Supabase setup.");
      return;
    }

    lastSyncedPayloadRef.current = JSON.stringify(appStateRef.current);
    setSyncStatus(`Synced at ${new Date().toLocaleTimeString()}.`);
  };

  const sendMagicLink = async () => {
    if (!syncConfigured || !supabase || !syncEmail.trim()) {
      setSyncStatus("Enter your email to get a sign-in link.");
      return;
    }

    setSyncBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: syncEmail.trim(),
      options: {
        emailRedirectTo: window.location.origin,
      },
    });
    setSyncBusy(false);

    setSyncStatus(
      error
        ? "Could not send login email. Check your Supabase auth settings."
        : `Magic link sent to ${syncEmail.trim()}. Open it on this device.`,
    );
  };

  const signOutSync = async () => {
    if (!syncConfigured || !supabase) return;
    await supabase.auth.signOut();
    setSyncStatus("Signed out of sync.");
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  };

  const numericProfileFields = new Set([
    "targetWeight",
    "calorieGoal",
    "tdee",
    "proteinGoal",
    "workoutGoal",
  ]);

  useEffect(() => {
    if (!syncUser) return;
    pullFromCloud();
  }, [syncUser]);

  useEffect(() => {
    if (!syncConfigured || !syncUser) return undefined;

    const payload = JSON.stringify({
      profile,
      weightLogs,
      calorieLogs,
      workoutLogs,
      activityLogs,
    });

    if (syncingFromCloudRef.current) {
      syncingFromCloudRef.current = false;
      lastSyncedPayloadRef.current = payload;
      return undefined;
    }

    if (payload === lastSyncedPayloadRef.current) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      pushToCloud();
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [profile, weightLogs, calorieLogs, workoutLogs, activityLogs, syncUser, syncConfigured]);

  useEffect(() => {
    if (!trackedDates.length) return;
    if (!trackedDates.includes(selectedDate)) {
      setSelectedDate(trackedDates[0]);
    }
  }, [trackedDates, selectedDate]);

  useEffect(() => {
    if (!dayCarouselRef.current) return;
    const selectedPill = dayCarouselRef.current.querySelector(`[data-date="${selectedDate}"]`);
    if (!selectedPill) return;
    selectedPill.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selectedDate]);

  const handleProfileChange = (field, value) => {
    setProfile((current) => ({
      ...current,
      [field]: numericProfileFields.has(field) ? (value === "" ? "" : Number(value)) : value,
    }));

    if (field === "calorieGoal") {
      setCalorieForm((current) => ({ ...current, goal: value }));
    }
  };

  const handleWeightSubmit = (event) => {
    event.preventDefault();

    const weight = numberOrNull(weightForm.weight);

    if (!weight) {
      return;
    }

    const entry = {
      id: weightForm.id || createId("weight"),
      date: weightForm.date,
      weight,
      bodyFat: numberOrNull(weightForm.bodyFat),
      note: weightForm.note.trim(),
    };

    setWeightLogs((current) => [entry, ...current.filter((item) => item.id !== entry.id && item.date !== entry.date)]);
    setWeightForm(createWeightForm());
    setSelectedDate(entry.date);
  };

  const handleCalorieSubmit = (event) => {
    event.preventDefault();

    const calories = numberOrNull(calorieForm.calories);

    if (!calories) {
      return;
    }

    const entry = {
      id: calorieForm.id || createId("calories"),
      date: calorieForm.date,
      calories,
      goal: numberOrNull(calorieForm.goal) || appliedCalorieGoal || coach.recommendedCalories,
      protein: numberOrNull(calorieForm.protein),
      carbs: numberOrNull(calorieForm.carbs),
      fats: numberOrNull(calorieForm.fats),
      note: calorieForm.note.trim(),
    };

    setCalorieLogs((current) => [entry, ...current.filter((item) => item.id !== entry.id && item.date !== entry.date)]);
    setCalorieForm(createCalorieForm(undefined, Number(profile.calorieGoal) || coach.recommendedCalories || 0));
    setSelectedDate(entry.date);
  };

  const updateWorkoutField = (field, value) => {
    setWorkoutForm((current) => ({ ...current, [field]: value }));
  };

  const updateExerciseName = (exerciseId, value) => {
    setWorkoutForm((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) =>
        exercise.id === exerciseId ? { ...exercise, name: value } : exercise,
      ),
    }));
  };

  const addExercise = () => {
    setWorkoutForm((current) => ({
      ...current,
      exercises: [...current.exercises, makeExercise("")],
    }));
  };

  const removeExercise = (exerciseId) => {
    setWorkoutForm((current) => ({
      ...current,
      exercises:
        current.exercises.length === 1
          ? current.exercises
          : current.exercises.filter((exercise) => exercise.id !== exerciseId),
    }));
  };

  const updateSetField = (exerciseId, setId, field, value) => {
    setWorkoutForm((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) =>
        exercise.id !== exerciseId
          ? exercise
          : {
              ...exercise,
              sets: exercise.sets.map((set) => (set.id === setId ? { ...set, [field]: value } : set)),
            },
      ),
    }));
  };

  const addSet = (exerciseId) => {
    setWorkoutForm((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) =>
        exercise.id === exerciseId
          ? { ...exercise, sets: [...exercise.sets, makeWorkoutSet("", "")] }
          : exercise,
      ),
    }));
  };

  const removeSet = (exerciseId, setId) => {
    setWorkoutForm((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) =>
        exercise.id !== exerciseId
          ? exercise
          : {
              ...exercise,
              sets:
                exercise.sets.length === 1
                  ? exercise.sets
                  : exercise.sets.filter((set) => set.id !== setId),
            },
      ),
    }));
  };

  const handleWorkoutSubmit = (event) => {
    event.preventDefault();

    const exercises = workoutForm.exercises
      .map((exercise) => ({
        ...exercise,
        name: exercise.name.trim(),
        sets: exercise.sets
          .map((set) => ({
            ...set,
            reps: numberOrNull(set.reps),
            weight: numberOrNull(set.weight),
          }))
          .filter((set) => set.reps),
      }))
      .filter((exercise) => exercise.name && exercise.sets.length);

    if (!workoutForm.title.trim() || !exercises.length) {
      return;
    }

    const entry = {
      id: workoutForm.id || createId("workout"),
      date: workoutForm.date,
      loggedAt: workoutForm.id
        ? workoutLogs.find((session) => session.id === workoutForm.id)?.loggedAt || new Date().toISOString()
        : new Date().toISOString(),
      title: workoutForm.title.trim(),
      focus: workoutForm.focus.trim(),
      duration: numberOrNull(workoutForm.duration),
      notes: workoutForm.notes.trim(),
      exercises,
    };

    setWorkoutLogs((current) => [entry, ...current.filter((session) => session.id !== entry.id)]);
    setWorkoutForm(createWorkoutForm());
    setSelectedDate(entry.date);
  };

  const markRestDay = (date = workoutForm.date || selectedDate) => {
    const existing = activityLogs.find((entry) => entry.date === date && entry.type === "rest");
    const entry = createRestDayEntry(date, existing);

    setActivityLogs((current) => [entry, ...current.filter((item) => item.id !== entry.id && item.date !== entry.date)]);
    setWorkoutForm(createWorkoutForm({ date }));
    setSelectedDate(date);
  };

  const applyRecommendedCalories = () => {
    if (!coach.recommendedCalories) return;

    setProfile((current) => ({
      ...current,
      calorieGoal: coach.recommendedCalories,
      proteinGoal: DEFAULT_PROTEIN_GOAL,
    }));

    setCalorieForm((current) => ({
      ...current,
      goal: String(coach.recommendedCalories),
    }));
  };

  const useRecommendedProtein = () => {
    setProfile((current) => ({
      ...current,
      proteinGoal: DEFAULT_PROTEIN_GOAL,
    }));
  };

  const jumpToSection = (section) => {
    setActiveSection(section);
    setMenuOpen(false);
  };

  const openMacroLog = (date = selectedDate) => {
    const entry = calorieLogs.find((item) => item.date === date);
    setCalorieForm(createCalorieForm(entry || { date }, Number(profile.calorieGoal) || coach.recommendedCalories || 0));
    setSelectedDate(date);
    jumpToSection("macroLog");
  };

  const openWeightLog = (date = selectedDate) => {
    const entry = weightLogs.find((item) => item.date === date);
    setWeightForm(createWeightForm(entry || { date }));
    setSelectedDate(date);
    jumpToSection("weightLog");
  };

  const openWorkoutLog = (date = selectedDate) => {
    const session = sortByDateDesc(workoutLogs).find((item) => item.date === date);
    setWorkoutForm(createWorkoutForm(session || { date }));
    setSelectedDate(date);
    jumpToSection("workoutLog");
  };

  const startEditingWeight = (entry) => {
    setWeightForm(createWeightForm(entry));
    setSelectedDate(entry.date);
    setActiveSection("weightLog");
  };

  const startEditingCalories = (entry) => {
    setCalorieForm(createCalorieForm(entry, Number(profile.calorieGoal) || coach.recommendedCalories || 0));
    setSelectedDate(entry.date);
    setActiveSection("macroLog");
  };

  const startEditingWorkout = (session) => {
    setWorkoutForm(createWorkoutForm(session));
    setSelectedDate(session.date);
    setActiveSection("workoutLog");
  };

  const deleteWeightEntry = (entryId) => {
    setWeightLogs((current) => current.filter((entry) => entry.id !== entryId));
    if (weightForm.id === entryId) {
      setWeightForm(createWeightForm());
    }
  };

  const deleteCalorieEntry = (entryId) => {
    setCalorieLogs((current) => current.filter((entry) => entry.id !== entryId));
    if (calorieForm.id === entryId) {
      setCalorieForm(createCalorieForm(undefined, Number(profile.calorieGoal) || coach.recommendedCalories || 0));
    }
  };

  const deleteWorkoutEntry = (entryId) => {
    setWorkoutLogs((current) => current.filter((entry) => entry.id !== entryId));
    if (workoutForm.id === entryId) {
      setWorkoutForm(createWorkoutForm());
    }
  };

  const deleteActivityEntry = (entryId) => {
    setActivityLogs((current) => current.filter((entry) => entry.id !== entryId));
  };

  const clearHistory = () => {
    if (!window.confirm("Clear all weight, calorie, workout, and rest-day history?")) return;
    setWeightLogs([]);
    setCalorieLogs([]);
    setWorkoutLogs([]);
    setActivityLogs([]);
    setWeightForm(createWeightForm());
    setCalorieForm(createCalorieForm(undefined, Number(profile.calorieGoal) || ""));
    setWorkoutForm(createWorkoutForm());
    setSelectedDate(vietnamToday);
  };

  const resetApp = () => {
    if (!window.confirm("Reset the app and start setup again? This clears your profile and all history.")) return;
    const seed = buildSeedData();
    localStorage.removeItem(STORAGE_KEY);
    setProfile(seed.profile);
    setWeightLogs(seed.weightLogs);
    setCalorieLogs(seed.calorieLogs);
    setWorkoutLogs(seed.workoutLogs);
    setActivityLogs(seed.activityLogs);
    setSetupForm(createSetupState(seed.profile, null));
    setWeightForm(createWeightForm());
    setCalorieForm(createCalorieForm(undefined, ""));
    setWorkoutForm(createWorkoutForm());
    setShowSetup(true);
    setActiveSection("home");
    setMenuOpen(false);
    setSelectedDate(vietnamToday);
  };

  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };

  const toggleTimeZone = () => {
    setTimeZoneKey((current) => (current === "vietnam" ? "uk" : "vietnam"));
  };

  const showOlderDay = () => {
    if (olderDate) {
      setSelectedDate(olderDate);
    }
  };

  const showNewerDay = () => {
    if (newerDate) {
      setSelectedDate(newerDate);
    }
  };

  const handleStatusTouchStart = (event) => {
    swipeStartXRef.current = event.changedTouches[0]?.clientX ?? null;
  };

  const handleStatusTouchEnd = (event) => {
    if (swipeStartXRef.current === null) return;
    const endX = event.changedTouches[0]?.clientX ?? swipeStartXRef.current;
    const deltaX = endX - swipeStartXRef.current;
    swipeStartXRef.current = null;

    if (Math.abs(deltaX) < 40) return;

    if (deltaX < 0) {
      showOlderDay();
    } else {
      showNewerDay();
    }
  };

  const openSetup = () => {
    setSetupForm(createSetupState(profile, latestWeight));
    setSetupError("");
    setShowSetup(true);
  };

  const handleSetupSubmit = (event) => {
    event.preventDefault();

    const currentWeight = numberOrNull(setupForm.currentWeight);
    const targetWeightValue = numberOrNull(setupForm.targetWeight);
    const weeklyWorkouts = numberOrNull(setupForm.workoutGoal);

    if (!setupForm.name.trim()) {
      setSetupError("Add your name to continue.");
      return;
    }

    if (!currentWeight) {
      setSetupError("Add your current weight to continue.");
      return;
    }

    if (!targetWeightValue) {
      setSetupError("Add your target weight to continue.");
      return;
    }

    if (!setupForm.targetDate) {
      setSetupError("Pick a target date to continue.");
      return;
    }

    if (setupForm.goalType === "fat_loss" && targetWeightValue >= currentWeight) {
      setSetupError("For fat loss, target weight should be below current weight.");
      return;
    }

    if (setupForm.goalType === "muscle_gain" && targetWeightValue <= currentWeight) {
      setSetupError("For muscle gain, target weight should be above current weight.");
      return;
    }

    setSetupError("");

    const nextWeightEntry = {
      id: createId("weight"),
      date: vietnamToday,
      weight: currentWeight,
      bodyFat: null,
      note: "",
    };

    const nextWeightLogs = [
      nextWeightEntry,
      ...weightLogs.filter((entry) => entry.date !== nextWeightEntry.date),
    ];

    const draftProfile = {
      ...profile,
      setupComplete: true,
      name: setupForm.name.trim(),
      goalType: setupForm.goalType,
      activityLevel: setupForm.activityLevel,
      targetWeight: targetWeightValue,
      targetDate: setupForm.targetDate,
      workoutGoal: weeklyWorkouts || 0,
      calorieGoal: numberOrNull(profile.calorieGoal) || 0,
      tdee: Number(profile.tdee) || DEFAULT_TDEE,
      proteinGoal: DEFAULT_PROTEIN_GOAL,
    };

    const draftCoach = buildCalorieCoach(draftProfile, nextWeightLogs, [], [], [], vietnamToday);
    const nextProfile = {
      ...draftProfile,
      calorieGoal:
        draftCoach.recommendedCalories ||
        draftCoach.maintenanceCalories ||
        draftProfile.calorieGoal,
      proteinGoal: DEFAULT_PROTEIN_GOAL,
    };

    setProfile(nextProfile);
    setWeightLogs(nextWeightLogs);
    setCalorieForm((current) => ({
      ...current,
      goal: String(nextProfile.calorieGoal || ""),
    }));
    setShowSetup(false);
  };

  if (showSetup) {
    const setupCoachPreview = buildCalorieCoach(
      {
        ...profile,
        name: setupForm.name.trim(),
        goalType: setupForm.goalType,
        activityLevel: setupForm.activityLevel,
        targetWeight: numberOrNull(setupForm.targetWeight) ?? profile.targetWeight,
        targetDate: setupForm.targetDate,
        workoutGoal: numberOrNull(setupForm.workoutGoal) || 0,
      },
      numberOrNull(setupForm.currentWeight)
        ? [
            {
              id: "setup-weight",
              date: vietnamToday,
              weight: numberOrNull(setupForm.currentWeight),
            },
          ]
        : [],
      [],
      [],
      [],
      vietnamToday,
    );

    return (
      <div className="shell shell-setup">
        <section className="panel setup-card">
          <div className="setup-header">
            <p className="eyebrow">Setup</p>
            <h1>Your target, first</h1>
            <p className="setup-copy">Set your starting weight, goal, and timeline.</p>
          </div>

          <form className="log-form" onSubmit={handleSetupSubmit}>
            <div className="setup-grid">
              <label>
                Name
                <input
                  type="text"
                  value={setupForm.name}
                  onChange={(event) =>
                    setSetupForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Eric"
                />
              </label>
              <label>
                Current weight (kg)
                <input
                  type="number"
                  step="0.1"
                  value={setupForm.currentWeight}
                  onChange={(event) =>
                    setSetupForm((current) => ({ ...current, currentWeight: event.target.value }))
                  }
                  placeholder="78.0"
                />
              </label>
              <label>
                Goal type
                <select
                  value={setupForm.goalType}
                  onChange={(event) =>
                    setSetupForm((current) => ({ ...current, goalType: event.target.value }))
                  }
                >
                  {Object.entries(GOAL_TYPES).map(([key, value]) => (
                    <option value={key} key={key}>
                      {value.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Activity level
                <select
                  value={setupForm.activityLevel}
                  onChange={(event) =>
                    setSetupForm((current) => ({ ...current, activityLevel: event.target.value }))
                  }
                >
                  {Object.entries(ACTIVITY_LEVELS).map(([key, value]) => (
                    <option value={key} key={key}>
                      {value.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Target weight (kg)
                <input
                  type="number"
                  step="0.1"
                  value={setupForm.targetWeight}
                  onChange={(event) =>
                    setSetupForm((current) => ({ ...current, targetWeight: event.target.value }))
                  }
                  placeholder="74.0"
                />
              </label>
              <label>
                Target date
                <input
                  type="date"
                  value={setupForm.targetDate}
                  onChange={(event) =>
                    setSetupForm((current) => ({ ...current, targetDate: event.target.value }))
                  }
                />
              </label>
              <label>
                Workout days / week
                <input
                  type="number"
                  min="0"
                  max="7"
                  step="1"
                  value={setupForm.workoutGoal}
                  onChange={(event) =>
                    setSetupForm((current) => ({ ...current, workoutGoal: event.target.value }))
                  }
                />
              </label>
            </div>

            <div className="setup-preview">
              <div className="mini-stat">
                <span>Recommended calories</span>
                <strong>
                  {setupCoachPreview.recommendedCalories
                    ? `${setupCoachPreview.recommendedCalories} kcal`
                    : "--"}
                </strong>
                <small>
                  {`${DEFAULT_PROTEIN_GOAL} g protein`}
                </small>
              </div>
              <div className="mini-stat">
                <span>Weekly pace</span>
                <strong>
                  {setupCoachPreview.requiredKgPerWeek !== null
                    ? `${shortNumber(Math.abs(setupCoachPreview.requiredKgPerWeek), 2)} kg`
                    : "--"}
                </strong>
                <small>{setupCoachPreview.targetSummary}</small>
              </div>
            </div>

            {setupError ? <div className="form-error">{setupError}</div> : null}

            <div className="setup-actions">
              {profile.setupComplete ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setShowSetup(false)}
                >
                  Back
                </button>
              ) : null}
              <button type="submit" className="primary-button setup-submit">
                Continue
              </button>
            </div>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="shell app-shell">
      <header className="app-topbar native-topbar">
        <span className="status-time">{vietnamTime}</span>
        <div className="topbar-copy">
          <h1>Dashboard</h1>
        </div>
        <div className="topbar-actions">
          <button type="button" className="mini-toggle" onClick={toggleTheme}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button type="button" className="mini-toggle" onClick={toggleTimeZone}>
            {activeTimeZone.label}
          </button>
          <button type="button" className="profile-dot profile-name" onClick={openSetup} aria-label="Edit targets">
            {profile.name || "Profile"}
          </button>
        </div>
      </header>

      {menuOpen ? <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} /> : null}

      <aside className={`panel side-menu ${menuOpen ? "open" : ""}`}>
        <div className="section-top">
          <div>
            <p className="eyebrow">Menu</p>
            <h2>Sections</h2>
          </div>
          <button type="button" className="ghost-button" onClick={() => setMenuOpen(false)}>
            Close
          </button>
        </div>
        <div className="menu-links">
          <button type="button" className={activeSection === "home" ? "tab active" : "tab"} onClick={() => jumpToSection("home")}>
            Home
          </button>
          <button type="button" className={activeSection === "coach" ? "tab active" : "tab"} onClick={() => jumpToSection("coach")}>
            Coach
          </button>
          <button type="button" className={activeSection === "history" ? "tab active" : "tab"} onClick={() => jumpToSection("history")}>
            History
          </button>
          <button type="button" className={activeSection === "reset" ? "tab active" : "tab"} onClick={() => jumpToSection("reset")}>
            Reset
          </button>
        </div>
      </aside>

      {activeSection === "home" ? (
        <section className="stack">
          <article
            className="panel dashboard-card status-card"
            onTouchStart={handleStatusTouchStart}
            onTouchEnd={handleStatusTouchEnd}
          >
            <div className="section-top">
              <div>
                <p className="eyebrow">Nutrition</p>
                <h2>{selectedDate === vietnamToday ? "Current State" : formatDate(selectedDate)}</h2>
              </div>
              <span className="section-note">{activeTimeZone.badge} · {vietnamTime}</span>
            </div>

            <div className="status-toolbar">
              <div className="date-switcher-copy">
                <strong>{formatDate(selectedDate, { weekday: "short", month: "short", day: "numeric" })}</strong>
                <small>{selectedDate === vietnamToday ? "Today" : "Past entry"}</small>
              </div>
              <div className="status-nav">
                <button type="button" className="ghost-button" onClick={showNewerDay} disabled={!newerDate}>
                  Newer
                </button>
                <button type="button" className="ghost-button" onClick={showOlderDay} disabled={!olderDate}>
                  Older
                </button>
              </div>
            </div>

            <NutritionGauge
              calories={selectedCalories?.calories || 0}
              target={selectedCalorieTarget}
              protein={selectedCalories?.protein || 0}
              carbs={selectedCalories?.carbs || 0}
              fats={selectedCalories?.fats || 0}
            />

            <div className={`trend-reminder ${trendCheckDue ? "due" : ""}`}>
              <div>
                <span>Trend check</span>
                <strong>{trendCheckDue ? `Week ${completedTrendPeriods} ready` : `${daysToTrendCheck || 7}d left`}</strong>
              </div>
              <div>
                <span>Last checkpoint change</span>
                <strong>{lastCheckpointChange !== null ? `${signedNumber(lastCheckpointChange, 2)} kg` : "--"}</strong>
              </div>
              <small>
                {trendCheckDue
                  ? "Review your 7-day weight trend and calorie target."
                  : latestCheckpointAverage
                    ? `${formatDate(latestCheckpointAverage.start, { month: "short", day: "numeric" })}-${formatDate(latestCheckpointAverage.end, { month: "short", day: "numeric" })}`
                    : `Next check ${formatDate(nextTrendCheckDate, { month: "short", day: "numeric" })}`}
              </small>
              <button type="button" className="secondary-button" onClick={() => jumpToSection("weightDetail")}>
                View
              </button>
            </div>

            <div className="habits-section">
              <div className="section-title-row">
                <h2>Habits</h2>
              </div>
              <div className="habit-grid">
                <button type="button" className="habit-card" onClick={() => openMacroLog(selectedDate)}>
                  <span>Macro Logging</span>
                  <small>Last 28 Days</small>
                  <div className="habit-dots blue">
                    {macroHabitCycle.map((day) => (
                      <i
                        key={day.date}
                        title={formatDate(day.date)}
                        className={`${day.isLogged ? "done blue" : ""} ${day.isToday ? "today" : ""} ${day.isFuture ? "future" : ""}`}
                      />
                    ))}
                  </div>
                  <strong>{foodLogsThisWeek}/7 <small>this week</small></strong>
                </button>
                <button type="button" className="habit-card" onClick={() => openWeightLog(selectedDate)}>
                  <span>Weigh-In</span>
                  <small>Last 28 Days</small>
                  <div className="habit-dots">
                    {weighInHabitCycle.map((day) => (
                      <i
                        key={day.date}
                        title={formatDate(day.date)}
                        className={`${day.isLogged ? "done green" : ""} ${day.isToday ? "today" : ""} ${day.isFuture ? "future" : ""}`}
                      />
                    ))}
                  </div>
                  <strong>{weighInsThisWeek}/7 <small>this week</small></strong>
                </button>
                <button type="button" className="habit-card workout-habit-card" onClick={() => openWorkoutLog(selectedDate)}>
                  <span>Activity Logging</span>
                  <small>Last 28 Days</small>
                  <div className="habit-dots orange">
                    {workoutHabitCycle.map((day) => (
                      <i
                        key={day.date}
                        title={formatDate(day.date)}
                        className={`${day.isLogged ? "done orange" : ""} ${day.isToday ? "today" : ""} ${day.isFuture ? "future" : ""}`}
                      />
                    ))}
                  </div>
                  <strong>{workoutsLoggedThisWeek}/7 <small>this week</small></strong>
                </button>
              </div>
            </div>

            <div className="insights-section">
              <div className="section-title-row">
                <h2>Trends</h2>
              </div>
              <div className="insight-cards mini-dashboard-grid">
                {topCards.map((card) => (
                  <button type="button" className={`insight-card ${card.tone}`} key={card.title} onClick={card.action}>
                    <span>{card.title}</span>
                    <small>{card.subtitle}</small>
                    <strong>{card.value}</strong>
                    <i>›</i>
                  </button>
                ))}
              </div>
            </div>

          </article>
        </section>
      ) : null}

      {activeSection === "macroLog" ? (
        <section className="stack">
          <article className="panel composer-card log-hub-card">
            <div className="section-top">
              <div>
                <p className="eyebrow">Log</p>
                <h2>Macros</h2>
              </div>
              <button type="button" className="ghost-button" onClick={() => jumpToSection("home")}>
                Dashboard
              </button>
            </div>

            <form className="log-form daily-card" onSubmit={handleCalorieSubmit}>
              <div className="daily-head">
                <div>
                  <p className="eyebrow">{calorieForm.id ? "Edit" : "New"}</p>
                  <h2>{formatDate(calorieForm.date)}</h2>
                </div>
                <span className="section-note">Goal {calorieForm.goal || profile.calorieGoal || coach.recommendedCalories || "--"}</span>
              </div>
              <div className="field-grid compact-grid">
                <label>
                  Date
                  <input
                    type="date"
                    value={calorieForm.date}
                    onChange={(event) => {
                      const date = event.target.value;
                      const existing = calorieLogs.find((entry) => entry.date === date);
                      setCalorieForm(createCalorieForm(existing || { date }, Number(profile.calorieGoal) || coach.recommendedCalories || 0));
                    }}
                  />
                </label>
                <label>
                  Calories
                  <input
                    type="number"
                    step="1"
                    value={calorieForm.calories}
                    onChange={(event) => setCalorieForm((current) => ({ ...current, calories: event.target.value }))}
                    placeholder="2120"
                  />
                </label>
                <label>
                  Protein (g)
                  <input
                    type="number"
                    step="1"
                    value={calorieForm.protein}
                    onChange={(event) => setCalorieForm((current) => ({ ...current, protein: event.target.value }))}
                    placeholder="200"
                  />
                </label>
                <label>
                  Carbs (g)
                  <input
                    type="number"
                    step="1"
                    value={calorieForm.carbs}
                    onChange={(event) => setCalorieForm((current) => ({ ...current, carbs: event.target.value }))}
                    placeholder="220"
                  />
                </label>
                <label>
                  Fats (g)
                  <input
                    type="number"
                    step="1"
                    value={calorieForm.fats}
                    onChange={(event) => setCalorieForm((current) => ({ ...current, fats: event.target.value }))}
                    placeholder="60"
                  />
                </label>
                <label>
                  Goal calories
                  <input
                    type="number"
                    step="1"
                    value={calorieForm.goal}
                    onChange={(event) => setCalorieForm((current) => ({ ...current, goal: event.target.value }))}
                    placeholder={String(profile.calorieGoal || coach.recommendedCalories || "")}
                  />
                </label>
              </div>
              <div className="action-row dual-actions">
                <button type="submit" className="primary-button">
                  {calorieForm.id ? "Update macros" : "Save macros"}
                </button>
                {calorieForm.id ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setCalorieForm(createCalorieForm({ date: calorieForm.date }, Number(profile.calorieGoal) || coach.recommendedCalories || 0))}
                  >
                    New for date
                  </button>
                ) : null}
              </div>
            </form>

            <div className="history-list compact-history">
              {sortedCalories.length ? sortedCalories.map((entry) => (
                <button type="button" className="history-row history-button" key={entry.id} onClick={() => startEditingCalories(entry)}>
                  <div>
                    <strong>{shortNumber(entry.calories, 0)} kcal</strong>
                    <span>{formatDate(entry.date)}</span>
                  </div>
                  <div className="history-detail">
                    <span>{entry.protein ? `${shortNumber(entry.protein, 0)} g protein` : "Protein not set"}</span>
                    <span>Goal {entry.goal ? `${shortNumber(entry.goal, 0)} kcal` : "--"}</span>
                  </div>
                </button>
              )) : <div className="empty-state">No macro logs yet.</div>}
            </div>
          </article>
        </section>
      ) : null}

      {activeSection === "weightLog" ? (
        <section className="stack">
          <article className="panel composer-card log-hub-card">
            <div className="section-top">
              <div>
                <p className="eyebrow">Log</p>
                <h2>Weigh-In</h2>
              </div>
              <button type="button" className="ghost-button" onClick={() => jumpToSection("home")}>
                Dashboard
              </button>
            </div>

            <form className="log-form daily-card" onSubmit={handleWeightSubmit}>
              <div className="daily-head">
                <div>
                  <p className="eyebrow">{weightForm.id ? "Edit" : "New"}</p>
                  <h2>{formatDate(weightForm.date)}</h2>
                </div>
                <span className="section-note">7d avg {latestRollingWeight ? shortNumber(latestRollingWeight.sevenDayAverage, 1) : "--"} kg</span>
              </div>
              <div className="field-grid compact-grid">
                <label>
                  Date
                  <input
                    type="date"
                    value={weightForm.date}
                    onChange={(event) => {
                      const date = event.target.value;
                      const existing = weightLogs.find((entry) => entry.date === date);
                      setWeightForm(createWeightForm(existing || { date }));
                    }}
                  />
                </label>
                <label>
                  Weight (kg)
                  <input
                    type="number"
                    step="0.1"
                    value={weightForm.weight}
                    onChange={(event) => setWeightForm((current) => ({ ...current, weight: event.target.value }))}
                    placeholder="77.8"
                  />
                </label>
                <label>
                  Body fat %
                  <input
                    type="number"
                    step="0.1"
                    value={weightForm.bodyFat}
                    onChange={(event) => setWeightForm((current) => ({ ...current, bodyFat: event.target.value }))}
                    placeholder="18.6"
                  />
                </label>
              </div>
              <div className="action-row dual-actions">
                <button type="submit" className="primary-button">
                  {weightForm.id ? "Update weight" : "Save weight"}
                </button>
                {weightForm.id ? (
                  <button type="button" className="ghost-button" onClick={() => setWeightForm(createWeightForm({ date: weightForm.date }))}>
                    New for date
                  </button>
                ) : null}
              </div>
            </form>

            <div className="history-list compact-history">
              {sortedWeights.length ? sortedWeights.map((entry) => (
                <button type="button" className="history-row history-button" key={entry.id} onClick={() => startEditingWeight(entry)}>
                  <div>
                    <strong>{shortNumber(entry.weight, 1)} kg</strong>
                    <span>{formatDate(entry.date)}</span>
                  </div>
                  <div className="history-detail">
                    {entry.bodyFat ? <span>{shortNumber(entry.bodyFat, 1)}% BF</span> : <span>No body-fat entry</span>}
                  </div>
                </button>
              )) : <div className="empty-state">No weigh-ins yet.</div>}
            </div>
          </article>
        </section>
      ) : null}

      {activeSection === "workoutLog" ? (
        <section className="stack">
          <article className="panel composer-card log-hub-card">
            <div className="section-top">
              <div>
                <p className="eyebrow">Log</p>
                <h2>Activity</h2>
              </div>
              <button type="button" className="ghost-button" onClick={() => jumpToSection("home")}>
                Dashboard
              </button>
            </div>

            <div className="daily-card rest-day-card">
              <div className="daily-head">
                <div>
                  <p className="eyebrow">Non-workout</p>
                  <h2>{formatDate(workoutForm.date)}</h2>
                </div>
                <span className="section-note">
                  {workoutFormActivity?.type === "rest" ? "Logged rest" : "Optional"}
                </span>
              </div>
              <div className="action-row dual-actions">
                <button type="button" className="secondary-button" onClick={() => markRestDay(workoutForm.date)}>
                  Mark non-workout
                </button>
                {workoutFormActivity?.type === "rest" ? (
                  <button type="button" className="ghost-button" onClick={() => deleteActivityEntry(workoutFormActivity.id)}>
                    Clear mark
                  </button>
                ) : null}
              </div>
            </div>

            <form className="log-form" onSubmit={handleWorkoutSubmit}>
                <div className="field-grid">
                  <label>
                    Date
                    <input
                      type="date"
                      value={workoutForm.date}
                      onChange={(event) => {
                        const date = event.target.value;
                        const existing = sortByDateDesc(workoutLogs).find((entry) => entry.date === date);
                        setWorkoutForm(createWorkoutForm(existing || { date }));
                      }}
                    />
                  </label>
                  <label>
                    Session title
                    <input type="text" value={workoutForm.title} onChange={(event) => updateWorkoutField("title", event.target.value)} placeholder="Push Day" />
                  </label>
                  <label>
                    Focus
                    <input type="text" value={workoutForm.focus} onChange={(event) => updateWorkoutField("focus", event.target.value)} placeholder="Chest + Triceps" />
                  </label>
                  <label>
                    Duration (min)
                    <input type="number" step="1" value={workoutForm.duration} onChange={(event) => updateWorkoutField("duration", event.target.value)} placeholder="60" />
                  </label>
                </div>

                <div className="exercise-builder">
                  {workoutForm.exercises.map((exercise, exerciseIndex) => (
                    <div className="exercise-card" key={exercise.id}>
                      <div className="exercise-head">
                        <label>
                          Exercise {exerciseIndex + 1}
                          <input
                            type="text"
                            value={exercise.name}
                            onChange={(event) => updateExerciseName(exercise.id, event.target.value)}
                            placeholder="Romanian Deadlift"
                          />
                        </label>
                        <button type="button" className="ghost-button" onClick={() => removeExercise(exercise.id)}>
                          Remove exercise
                        </button>
                      </div>

                      <div className="set-grid">
                        {exercise.sets.map((set, setIndex) => (
                          <div className="set-row" key={set.id}>
                            <strong>Set {setIndex + 1}</strong>
                            <label>
                              Reps
                              <input
                                type="number"
                                step="1"
                                min="1"
                                value={set.reps}
                                onChange={(event) => updateSetField(exercise.id, set.id, "reps", event.target.value)}
                                placeholder="8"
                              />
                            </label>
                            <label>
                              Weight (kg)
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                value={set.weight}
                                onChange={(event) => updateSetField(exercise.id, set.id, "weight", event.target.value)}
                                placeholder="60"
                              />
                            </label>
                            <button type="button" className="icon-button" onClick={() => removeSet(exercise.id, set.id)}>
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>

                      <button type="button" className="secondary-button" onClick={() => addSet(exercise.id)}>
                        Add set
                      </button>
                    </div>
                  ))}
                </div>

                <div className="action-row dual-actions">
                  <button type="button" className="secondary-button" onClick={addExercise}>
                    Add exercise
                  </button>
                </div>

                <label>
                  Notes
                  <textarea
                    value={workoutForm.notes}
                    onChange={(event) => updateWorkoutField("notes", event.target.value)}
                    placeholder="PR attempts, RPE notes, energy, or next-week changes..."
                  />
                </label>

                <div className="action-row dual-actions">
                  <button type="submit" className="primary-button">
                    {workoutForm.id ? "Update workout" : "Save workout"}
                  </button>
                  {workoutForm.id ? (
                    <button type="button" className="ghost-button" onClick={() => setWorkoutForm(createWorkoutForm({ date: workoutForm.date }))}>
                      New for date
                    </button>
                  ) : null}
                </div>
              </form>

            <div className="history-list compact-history">
              {workoutHistoryRows.length ? workoutHistoryRows.map((entry) => (
                entry.rowType === "rest" ? (
                  <button type="button" className="history-row history-button rest-row" key={entry.id} onClick={() => {
                    setWorkoutForm(createWorkoutForm({ date: entry.date }));
                    setSelectedDate(entry.date);
                  }}>
                    <div>
                      <strong>Non-workout day</strong>
                      <span>{formatDate(entry.date)}</span>
                    </div>
                    <div className="history-detail">
                      <span>Rest logged</span>
                      <span>Counts toward activity rate</span>
                    </div>
                  </button>
                ) : (
                  <button type="button" className="history-row history-button workout-row" key={entry.id} onClick={() => startEditingWorkout(entry)}>
                    <div>
                      <strong>{entry.title}</strong>
                      <span>{formatDate(entry.date)}</span>
                    </div>
                    <div className="history-detail">
                      <span>{entry.exercises.length} exercises</span>
                      <span>{entry.duration ? `${entry.duration} min` : "No duration"}</span>
                      <span>{shortNumber(getWorkoutVolume(entry), 0)} kg volume</span>
                    </div>
                  </button>
                )
              )) : <div className="empty-state">No activity logs yet.</div>}
            </div>
          </article>
        </section>
      ) : null}

      {activeSection === "weightDetail" ? (
        <section className="detail-screen">
          <header className="detail-header">
            <button type="button" className="detail-back" onClick={() => jumpToSection("home")}>‹</button>
            <strong>Weight Trend</strong>
            <button type="button" className="detail-icon" onClick={() => jumpToSection("coach")}>⌁</button>
          </header>
          <div className="detail-metrics">
            <div>
              <span>Average</span>
              <strong>{latestRollingWeight ? shortNumber(latestRollingWeight.sevenDayAverage, 1) : "--"} <small>kg</small></strong>
              <small>7-day avg</small>
            </div>
            <div>
              <span>Predicted</span>
              <strong>
                {predictedWeightChange.weeklyChangeKg !== null
                  ? signedNumber(predictedWeightChange.weeklyChangeKg, 2)
                  : "--"} <small>kg/wk</small>
              </strong>
              <small>{plannedPredictionIntake ? `${shortNumber(plannedPredictionIntake, 0)} kcal plan` : "needs intake"}</small>
            </div>
          </div>
          <article className="detail-chart-card">
            <WeightTrend points={rangedWeightPoints} />
          </article>
          <RangeTabs value={rangeKey} onChange={setRangeKey} />
          <article className="detail-insights">
            <h2>Insights & Data</h2>
            <div className="insight-row">
              <span>Actual trend</span>
              <strong>{selectedExpenditure.trendDays ? `${signedNumber(selectedExpenditure.weeklyRateKg, 2)} kg/wk` : "--"}</strong>
              <small>{selectedExpenditure.trendDays ? `${selectedExpenditure.trendDays}d observed` : "needs trend data"}</small>
            </div>
            <div className="insight-row">
              <span>Predicted trend</span>
              <strong>
                {predictedWeightChange.weeklyChangeKg !== null
                  ? `${signedNumber(predictedWeightChange.weeklyChangeKg, 2)} kg/wk`
                  : "--"}
              </strong>
              <small>{signedNumber(predictedWeightChange.dailyEnergyBalance, 0)} kcal/day balance</small>
            </div>
            <div className="insight-row">
              <span>Model density</span>
              <strong>{shortNumber(predictedWeightChange.energyDensity, 0)} kcal/kg</strong>
              <small>effective tissue energy</small>
            </div>
          </article>
        </section>
      ) : null}

      {activeSection === "calorieDetail" ? (
        <section className="detail-screen">
          <header className="detail-header">
            <button type="button" className="detail-back" onClick={() => jumpToSection("home")}>‹</button>
            <strong>Calories Balance</strong>
            <button type="button" className="detail-icon" onClick={() => jumpToSection("coach")}>≋</button>
          </header>
          <div className="detail-metrics">
            <div>
              <span>Average</span>
              <strong>{rangedAverageCalories ? shortNumber(rangedAverageCalories, 0) : "--"} <small>kcal</small></strong>
              <small>{rangeLabel} intake</small>
            </div>
            <div>
              <span>Difference</span>
              <strong>{selectedCalories && selectedCalorieTarget ? signedNumber(selectedCalories.calories - selectedCalorieTarget, 0) : "--"} <small>cal</small></strong>
              <small>today</small>
            </div>
          </div>
          <article className="detail-chart-card">
            <CalorieTrendChart data={calorieTrend} />
          </article>
          <RangeTabs value={rangeKey} onChange={setRangeKey} />
          <article className="detail-insights">
            <h2>Insights & Data</h2>
            <div className="insight-row">
              <span>Recommended</span>
              <strong>{coach.recommendedCalories || "--"} kcal</strong>
              <small>{coach.recommendedCalories && appliedCalorieGoal ? signedNumber(recommendationDelta, 0) : "--"}</small>
            </div>
            <div className="insight-row">
              <span>Range</span>
              <strong>{coach.recommendedCalories ? `${coach.calorieRangeLow}-${coach.calorieRangeHigh}` : "--"}</strong>
              <small>kcal</small>
            </div>
          </article>
        </section>
      ) : null}

      {activeSection === "energyBalanceDetail" ? (
        <section className="detail-screen energy-detail-screen">
          <header className="detail-header">
            <button type="button" className="detail-back" onClick={() => jumpToSection("home")}>‹</button>
            <strong>Energy Balance</strong>
            <button type="button" className="detail-icon" onClick={() => jumpToSection("coach")}>≋</button>
          </header>
          <div className="detail-metrics">
            <div>
              <span>Daily</span>
              <strong>{selectedCalories ? signedNumber(selectedEnergyDifference, 0) : "--"} <small>cal</small></strong>
              <small>consumed - spent</small>
            </div>
            <div>
              <span>Logged-day avg</span>
              <strong>
                {loggedEnergyBalanceDays.length
                  ? signedNumber(loggedEnergyBalanceAverage, 0)
                  : "--"} <small>cal</small>
              </strong>
              <small>{loggedEnergyBalanceDays.length}/{energyBalanceTrend.length} days logged</small>
            </div>
          </div>
          <article className="detail-chart-card">
            <EnergyBalanceChart data={energyBalanceTrend} />
          </article>
          <RangeTabs value={rangeKey} onChange={setRangeKey} />
          <article className="detail-insights">
            <h2>Insights & Data</h2>
            <div className="insight-row">
              <span>Consumed</span>
              <strong>{selectedCalories ? `${shortNumber(selectedCalories.calories, 0)} kcal` : "--"}</strong>
              <small>today</small>
            </div>
            <div className="insight-row">
              <span>Spent</span>
              <strong>{selectedExpenditure.expenditure ? `${shortNumber(selectedExpenditure.expenditure, 0)} kcal` : "--"}</strong>
              <small>trend adjusted</small>
            </div>
          </article>
        </section>
      ) : null}

      {activeSection === "expenditureDetail" ? (
        <section className="detail-screen expenditure-detail-screen">
          <header className="detail-header">
            <button type="button" className="detail-back" onClick={() => jumpToSection("home")}>‹</button>
            <strong>Expenditure</strong>
            <button type="button" className="detail-icon" onClick={() => jumpToSection("coach")}>≋</button>
          </header>
          <div className="detail-metrics expenditure-metrics">
            <div>
              <span>Average</span>
              <strong>
                {expenditureTrend.length
                  ? shortNumber(
                      expenditureTrend.reduce((sum, entry) => sum + (entry.expenditure || 0), 0) /
                        expenditureTrend.length,
                      0,
                    )
                  : "--"} <small>kcal</small>
              </strong>
              <small>{rangeLabel} expenditure</small>
            </div>
            <div>
              <span>Difference</span>
              <strong>
                {expenditureTrend.length > 1
                  ? signedNumber(
                      expenditureTrend.at(-1).expenditure - expenditureTrend[0].expenditure,
                      0,
                    )
                  : "--"} <small>cal</small>
              </strong>
              <small>{rangeLabel} change</small>
            </div>
          </div>
          <article className="detail-chart-card">
            <ExpenditureDetailChart data={expenditureTrend} />
          </article>
          <RangeTabs value={rangeKey} onChange={setRangeKey} />
          <article className="detail-insights expenditure-insights">
            <h2>Insights & Data</h2>
            <div className="insight-tile-grid">
              <div className="insight-tile">
                <span>Today</span>
                <strong>{selectedExpenditure.expenditure ? `${shortNumber(selectedExpenditure.expenditure, 0)} kcal` : "--"}</strong>
                <small>stable estimate</small>
              </div>
              <div className="insight-tile">
                <span>Baseline</span>
                <strong>{selectedExpenditure.base ? `${shortNumber(selectedExpenditure.base, 0)} kcal` : "--"}</strong>
                <small>Cunningham/profile seed</small>
              </div>
              <div className="insight-tile">
                <span>Activity rate</span>
                <strong>{shortNumber(selectedExpenditure.workoutsPerWeek, 1)} / wk</strong>
                <small>
                  {selectedExpenditure.activityLoggedDays
                    ? `${selectedExpenditure.workoutDays} workout, ${selectedExpenditure.restDays} rest`
                    : "using setup rate"}
                </small>
              </div>
              <div className="insight-tile">
                <span>Intake avg</span>
                <strong>{selectedExpenditure.averageIntake ? `${shortNumber(selectedExpenditure.averageIntake, 0)} kcal` : "--"}</strong>
                <small>{selectedExpenditure.loggedIntakeDays || 0} logged days</small>
              </div>
              <div className="insight-tile">
                <span>Trend rate</span>
                <strong>{selectedExpenditure.trendDays ? `${signedNumber(selectedExpenditure.weeklyRateKg, 2)} kg/wk` : "--"}</strong>
                <small>{selectedExpenditure.trendDays || 0}d trend</small>
              </div>
              <div className="insight-tile wide">
                <span>Source</span>
                <strong>
                  {selectedExpenditure.adaptiveExpenditure
                    ? `${shortNumber(selectedExpenditure.averageIntake, 0)} - ${signedNumber(selectedExpenditure.storedEnergyChange, 0)} = ${shortNumber(selectedExpenditure.adaptiveExpenditure, 0)}`
                    : `${shortNumber(selectedExpenditure.base, 0)} kcal baseline`}
                </strong>
                <small>
                  {selectedExpenditure.adaptiveExpenditure
                    ? `${shortNumber(selectedExpenditure.energyDensity, 0)} kcal/kg tissue density, damped for stability`
                    : `${selectedExpenditure.activityModifier ? `${signedNumber(selectedExpenditure.activityModifier, 0)} kcal activity modifier` : "waiting for trend + intake data"}`}
                </small>
              </div>
            </div>
          </article>
        </section>
      ) : null}

      {activeSection === "coach" ? (
        <section className="stack">
          <article className="panel dashboard-card">
            <div className="section-top">
              <div>
                <p className="eyebrow">Weight</p>
                <h2>Trend + 7d avg</h2>
              </div>
              <span className="section-note">Weekly avg</span>
            </div>
            <WeightTrend points={sortedWeights.slice(0, 14).reverse()} />
            <div className="weekly-averages-grid">
              {coach.weeklyAverages.slice(-4).map((week) => (
                <div className="weekly-average-card" key={week.weekStart}>
                  <span>{formatDate(week.weekStart, { month: "short", day: "numeric" })}</span>
                  <strong>{shortNumber(week.average, 1)} kg</strong>
                  <small>{week.count} weigh-ins</small>
                </div>
              ))}
            </div>
          </article>

          <article className="panel dashboard-card">
            <div className="section-top">
              <div>
                <p className="eyebrow">Calories</p>
                <h2>Actual vs rec</h2>
              </div>
              <span className="section-note">7 days</span>
            </div>
            <CalorieTrendChart data={calorieTrend} />
          </article>

          <article className="panel dashboard-card">
            <div className="section-top">
              <div>
                <p className="eyebrow">Coach</p>
                <h2>Calories</h2>
              </div>
              <span className="section-note">{ACTIVITY_LEVELS[profile.activityLevel]?.label || "Activity"}</span>
            </div>

            <div className="coach-grid">
              <div className="mini-stat">
                <span>Next</span>
                <strong>{coach.recommendedCalories ? `${coach.recommendedCalories}` : "--"}</strong>
                <small>kcal/day</small>
              </div>
              <div className="mini-stat">
                <span>Carbs</span>
                <strong>{macroTargets.carbs ? `${macroTargets.carbs} g` : "--"}</strong>
                <small>adaptive</small>
              </div>
              <div className="mini-stat">
                <span>Fats</span>
                <strong>{macroTargets.fats ? `${macroTargets.fats} g` : "--"}</strong>
                <small>adaptive</small>
              </div>
              <div className="mini-stat">
                <span>Change</span>
                <strong>{coach.recommendedCalories && appliedCalorieGoal ? signedNumber(recommendationDelta, 0) : "--"}</strong>
                <small>vs applied</small>
              </div>
              <div className="mini-stat">
                <span>Maint.</span>
                <strong>{coach.maintenanceCalories ? `${coach.maintenanceCalories} kcal` : "--"}</strong>
                <small>{ACTIVITY_LEVELS[profile.activityLevel]?.label || "Activity"}</small>
              </div>
              <div className="mini-stat">
                <span>Range</span>
                <strong>{coach.recommendedCalories ? `${coach.calorieRangeLow}-${coach.calorieRangeHigh}` : "--"}</strong>
                <small>kcal</small>
              </div>
              <div className="mini-stat">
                <span>Trend weight</span>
                <strong>{latestTrendWeight ? `${shortNumber(latestTrendWeight.trendWeight, 1)} kg` : "--"}</strong>
                <small>{coach.observedTrendLabel}</small>
              </div>
              <div className="mini-stat">
                <span>Protein</span>
                <strong>{Number(profile.proteinGoal) || DEFAULT_PROTEIN_GOAL} g</strong>
                <small>daily</small>
              </div>
            </div>

            <div className="action-row dual-actions">
              <button type="button" className="primary-button" onClick={applyRecommendedCalories}>
                Apply calories
              </button>
              <button type="button" className="secondary-button" onClick={useRecommendedProtein}>
                Set protein to 200g
              </button>
            </div>
          </article>

          <article className="panel dashboard-card">
            <div className="section-top">
              <div>
                <p className="eyebrow">Target date</p>
                <h2>Weight runway</h2>
              </div>
              <span className="section-note">{profile.targetDate ? formatDate(profile.targetDate) : "No date"}</span>
            </div>

            <div className={`coach-callout tone-${coach.targetTone}`}>
              <strong>{coach.targetTitle}</strong>
              <p>{coach.targetSummary}</p>
            </div>

            <div className="coach-grid">
              <div className="mini-stat">
                <span>Target weight</span>
                <strong>{targetWeight !== null ? `${shortNumber(targetWeight, 1)} kg` : "--"}</strong>
                <small>{coach.deltaToGoal !== null ? `${shortNumber(Math.abs(coach.deltaToGoal), 1)} kg from current` : "Add a current and target weight"}</small>
              </div>
              <div className="mini-stat">
                <span>Weeks left</span>
                <strong>{coach.weeksLeft !== null ? shortNumber(coach.weeksLeft, 1) : "--"}</strong>
                <small>From today to target date.</small>
              </div>
              <div className="mini-stat">
                <span>Next checkpoint</span>
                <strong>{coach.checkpointWeight !== null ? `${shortNumber(coach.checkpointWeight, 1)} kg` : "--"}</strong>
                <small>{coach.checkpointDate ? `Aim for ${formatDate(coach.checkpointDate)}` : "Needs a valid target date"}</small>
              </div>
              <div className="mini-stat">
                <span>Projected finish</span>
                <strong>{coach.projectedDate ? formatDate(coach.projectedDate) : "--"}</strong>
                <small>{coach.projectedSummary}</small>
              </div>
            </div>
          </article>
        </section>
      ) : null}

      {activeSection === "history" ? (
        <section className="history-grid">
          <article className="panel history-card">
            <div className="section-top">
              <div>
                <p className="eyebrow">Weight log</p>
                <h2>Weight</h2>
              </div>
              <span className="section-note">{sortedWeights.length} entries</span>
            </div>
            <div className="history-list">
              {sortedWeights.length ? sortedWeights.map((entry) => (
                <div className="history-row" key={entry.id}>
                  <div>
                    <strong>{shortNumber(entry.weight, 1)} kg</strong>
                    <span>{formatDate(entry.date)}</span>
                  </div>
                  <div className="history-detail">
                    {entry.bodyFat ? <span>{shortNumber(entry.bodyFat, 1)}% BF</span> : <span>No body-fat entry</span>}
                    {entry.note ? <span>{entry.note}</span> : null}
                  </div>
                  <div className="history-actions">
                    <button type="button" className="secondary-button" onClick={() => startEditingWeight(entry)}>
                      Edit
                    </button>
                    <button type="button" className="ghost-button" onClick={() => deleteWeightEntry(entry.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              )) : <div className="empty-state">No weight entries yet.</div>}
            </div>
          </article>

          <article className="panel history-card">
            <div className="section-top">
              <div>
                <p className="eyebrow">Nutrition</p>
                <h2>Calories</h2>
              </div>
              <span className="section-note">{sortedCalories.length} entries</span>
            </div>
            <div className="history-list">
              {sortedCalories.length ? sortedCalories.map((entry) => (
                <div className="history-row" key={entry.id}>
                  <div>
                    <strong>{shortNumber(entry.calories, 0)} kcal</strong>
                    <span>{formatDate(entry.date)}</span>
                  </div>
                  <div className="history-detail">
                    <span>{entry.protein ? `${shortNumber(entry.protein, 0)} g protein` : "Protein not set"}</span>
                    <span>{entry.carbs || entry.fats ? `${entry.carbs ? `${shortNumber(entry.carbs, 0)} c` : "--"} / ${entry.fats ? `${shortNumber(entry.fats, 0)} f` : "--"}` : "Macros not set"}</span>
                    <span>Goal: {entry.goal ? `${shortNumber(entry.goal, 0)} kcal` : "Not set"}</span>
                  </div>
                  <div className="history-actions">
                    <button type="button" className="secondary-button" onClick={() => startEditingCalories(entry)}>
                      Edit
                    </button>
                    <button type="button" className="ghost-button" onClick={() => deleteCalorieEntry(entry.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              )) : <div className="empty-state">No calorie entries yet.</div>}
            </div>
          </article>

          <article className="panel history-card">
            <div className="section-top">
              <div>
                <p className="eyebrow">Training</p>
                <h2>Activity</h2>
              </div>
              <span className="section-note">{workoutHistoryRows.length} logs</span>
            </div>
            <div className="history-list">
              {workoutHistoryRows.length ? workoutHistoryRows.map((entry) => (
                <div className={`history-row ${entry.rowType === "rest" ? "rest-row" : "workout-row"}`} key={entry.id}>
                  <div>
                    <strong>{entry.rowType === "rest" ? "Non-workout day" : entry.title}</strong>
                    <span>{formatDate(entry.date)}</span>
                  </div>
                  <div className="history-detail">
                    {entry.rowType === "rest" ? (
                      <>
                        <span>Rest logged</span>
                        <span>Counts toward activity rate</span>
                      </>
                    ) : (
                      <>
                        <span>{entry.exercises.length} exercises</span>
                        <span>{entry.duration ? `${entry.duration} min` : "No duration"}</span>
                        <span>{shortNumber(getWorkoutVolume(entry), 0)} kg volume</span>
                      </>
                    )}
                  </div>
                  <div className="history-actions">
                    {entry.rowType === "rest" ? (
                      <button type="button" className="ghost-button" onClick={() => deleteActivityEntry(entry.id)}>
                        Delete
                      </button>
                    ) : (
                      <>
                        <button type="button" className="secondary-button" onClick={() => startEditingWorkout(entry)}>
                          Edit
                        </button>
                        <button type="button" className="ghost-button" onClick={() => deleteWorkoutEntry(entry.id)}>
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )) : <div className="empty-state">No activity logs yet.</div>}
            </div>
          </article>
        </section>
      ) : null}

      {activeSection === "profile" ? (
        <section className="stack">
          <article className="panel profile-card">
            <div className="section-top">
              <div>
                <p className="eyebrow">Profile</p>
                <h2>{profile.name || "Athlete"}</h2>
              </div>
              <button type="button" className="ghost-button" onClick={openSetup}>
                Edit setup
              </button>
            </div>

            <div className="mini-form-grid">
              <label>
                Name
                <input type="text" value={profile.name} onChange={(event) => handleProfileChange("name", event.target.value)} />
              </label>
              <label>
                Goal type
                <select value={profile.goalType} onChange={(event) => handleProfileChange("goalType", event.target.value)}>
                  {Object.entries(GOAL_TYPES).map(([key, value]) => (
                    <option value={key} key={key}>
                      {value.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Activity level
                <select value={profile.activityLevel} onChange={(event) => handleProfileChange("activityLevel", event.target.value)}>
                  {Object.entries(ACTIVITY_LEVELS).map(([key, value]) => (
                    <option value={key} key={key}>
                      {value.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Target weight (kg)
                <input type="number" step="0.1" value={profile.targetWeight} onChange={(event) => handleProfileChange("targetWeight", event.target.value)} />
              </label>
              <label>
                Target date
                <input type="date" value={profile.targetDate} onChange={(event) => handleProfileChange("targetDate", event.target.value)} />
              </label>
              <label>
                Programme start
                <input type="date" value={profile.programStartDate || "2026-04-15"} onChange={(event) => handleProfileChange("programStartDate", event.target.value)} />
              </label>
              <label>
                Applied calories
                <input type="number" step="1" value={profile.calorieGoal} onChange={(event) => handleProfileChange("calorieGoal", event.target.value)} />
              </label>
              <label>
                Starting TDEE
                <input type="number" step="25" value={profile.tdee || DEFAULT_TDEE} onChange={(event) => handleProfileChange("tdee", event.target.value)} />
              </label>
              <label>
                Protein goal (g)
                <input type="number" step="1" value={profile.proteinGoal} onChange={(event) => handleProfileChange("proteinGoal", event.target.value)} />
              </label>
              <label>
                Weekly workouts
                <input type="number" step="1" min="0" max="7" value={profile.workoutGoal} onChange={(event) => handleProfileChange("workoutGoal", event.target.value)} />
              </label>
            </div>
          </article>
        </section>
      ) : null}

      {activeSection === "reset" ? (
        <section className="stack">
          <article className="panel dashboard-card">
            <div className="section-top">
              <div>
                <p className="eyebrow">Reset</p>
                <h2>Clear data</h2>
              </div>
              <span className="section-note">Permanent</span>
            </div>
            <div className="coach-grid">
              <div className="mini-stat">
                <span>Clear history</span>
                <strong>{weightLogs.length + calorieLogs.length + workoutLogs.length + activityLogs.length} entries</strong>
                <small>Removes all saved logs and keeps your profile.</small>
              </div>
              <div className="mini-stat">
                <span>Reset app</span>
                <strong>Start over</strong>
                <small>Clears profile, setup, and history.</small>
              </div>
            </div>
            <div className="action-row dual-actions">
              <button type="button" className="secondary-button" onClick={clearHistory}>
                Clear history
              </button>
              <button type="button" className="primary-button" onClick={resetApp}>
                Full reset
              </button>
            </div>
          </article>
        </section>
      ) : null}

      <nav className="bottom-nav" aria-label="Primary">
        <button type="button" className={activeSection === "home" ? "active" : ""} onClick={() => jumpToSection("home")}>
          <span>▦</span>
          Dashboard
        </button>
        <button
          type="button"
          className="nav-plus"
          aria-label="Add entry"
          onClick={() => {
            openMacroLog(vietnamToday);
          }}
        >
          +
        </button>
        <button type="button" className={activeSection === "coach" ? "active" : ""} onClick={() => jumpToSection("coach")}>
          <span>∘</span>
          Strategy
        </button>
      </nav>
    </div>
  );
}

export default App;
