import type { Activity, PlanEntry } from './training';
import type { FitActivity } from './fit';

export type TrainingReview = {
  summary: string;
  execution: string;
  intensity: string;
  next: string;
  limitations: string;
};

export type ReviewChatMessage = { role: 'user' | 'assistant'; text: string };

export type SavedReview = { review: TrainingReview; signature: string; reviewedAt: string; chat?: ReviewChatMessage[] };

const round = (value: number) => Math.round(value * 100) / 100;

function metrics(items: Activity[]) {
  return {
    minutes: round(items.reduce((sum, item) => sum + item.minutes, 0)),
    km: round(items.reduce((sum, item) => sum + item.km, 0)),
  };
}

function fitForReview(fit: FitActivity) {
  const count = Math.min(16, fit.laps.length);
  const laps = count === fit.laps.length ? fit.laps : Array.from({ length: count }, (_, index) =>
    fit.laps[Math.round(index * (fit.laps.length - 1) / (count - 1))]);
  const { heartRate: _chart, laps: _laps, ...summary } = fit;
  return { ...summary, lapCount: fit.laps.length, laps };
}

export function trainingReviewInput(date: string, plans: PlanEntry[], activities: Activity[]) {
  const slots = plans.filter((entry) => entry.date === date && entry.current && entry.current.type !== '休息');
  const sessions = activities.filter((activity) => activity.date === date);
  const main = sessions.find((activity) => activity.role === '主课');
  return {
    date,
    plan: slots.map(({ current }) => ({
      type: current!.type, minutes: current!.minutes > 0 ? current!.minutes : null, detail: current!.detail ?? null,
    })),
    total: metrics(sessions),
    mainWithWarmupAndCooldown: main ? metrics(sessions.filter((item) => item.id === main.id || item.parentId === main.id)) : null,
    activities: sessions.map((activity, index) => ({
      item: index + 1,
      parentItem: activity.parentId ? (sessions.findIndex((item) => item.id === activity.parentId) + 1 || null) : null,
      title: activity.title,
      role: activity.role,
      minutes: activity.minutes,
      km: activity.km || null,
      averagePaceSecPerKm: activity.km > 0 ? Math.round(activity.minutes * 60 / activity.km) : null,
      averageHr: activity.averageHr ?? null,
      core: activity.core ?? null,
      ...(activity.detail ? { detail: activity.detail } : {}),
      ...(activity.fit ? { fit: fitForReview(activity.fit) } : {}),
      ...(activity.feedback ? { feedback: activity.feedback } : {}),
    })),
  };
}

export type TrainingReviewInput = ReturnType<typeof trainingReviewInput>;

export function canReviewTraining(input: TrainingReviewInput) {
  return input.activities.length > 0 &&
    (input.activities.length === 1 || input.activities.every((activity) => activity.role !== '待归类'));
}
