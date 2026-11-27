import type { Activity } from './training';

/** 个人信息与热量管理：BMR、TDEE、运动消耗、每日饮食余额、喝水。 */

export const sexes = ['男', '女'] as const;
export type Sex = (typeof sexes)[number];

export const activityLevels = ['久坐', '轻度', '中度', '高度'] as const;
export type ActivityLevel = (typeof activityLevels)[number];

export const goals = ['维持', '减脂', '增肌'] as const;
export type Goal = (typeof goals)[number];

export type Profile = {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  /** 体脂率百分比（可选）。有体脂率时用 Katch-McArdle，更准确。 */
  bodyFatPct?: number;
  activityLevel: ActivityLevel;
  goal: Goal;
  /** 减脂/增肌速率（公斤/周），缺省减脂 0.5、增肌 0.25 */
  rateKgPerWeek?: number;
  /** 手动指定每日目标摄入（千卡）；填了就不再按公式算 */
  targetIntake?: number;
  /** 每日饮水目标（毫升），缺省按体重 30ml/kg */
  waterGoalMl?: number;
};

export type IntakeEntry = { id: string; date: string; kcal: number; label?: string };
export type WaterEntry = { id: string; date: string; ml: number };

export const profileIsComplete = (profile?: Profile | null): profile is Profile =>
  Boolean(profile && profile.age > 0 && profile.heightCm > 0 && profile.weightKg > 0);

/** 静息代谢：有体脂率用 Katch-McArdle，否则用 Mifflin-St Jeor（目前公认最稳的两个公式）。 */
export function basalMetabolicRate(profile: Profile): { kcal: number; method: string } {
  const weight = profile.weightKg;
  const height = profile.heightCm;
  const age = profile.age;
  if (profile.bodyFatPct && profile.bodyFatPct > 3 && profile.bodyFatPct < 60) {
    const leanMass = weight * (1 - profile.bodyFatPct / 100);
    return { kcal: Math.round(370 + 21.6 * leanMass), method: 'Katch-McArdle（按体脂率）' };
  }
  const base = 10 * weight + 6.25 * height - 5 * age;
  return { kcal: Math.round(profile.sex === '男' ? base + 5 : base - 161), method: 'Mifflin-St Jeor' };
}

/** 日常活动系数（不含正式运动，运动按实测单独相加，避免重复计算）。 */
export function neatFactor(level: ActivityLevel): number {
  return level === '久坐' ? 1.2 : level === '轻度' ? 1.3 : level === '中度' ? 1.4 : 1.5;
}

const paceMet = (kmPerHour: number): number => {
  if (kmPerHour >= 13) return 13.5;
  if (kmPerHour >= 12) return 11.8;
  if (kmPerHour >= 11) return 10.9;
  if (kmPerHour >= 10) return 9.8;
  if (kmPerHour >= 9) return 9.0;
  if (kmPerHour >= 8) return 8.3;
  if (kmPerHour >= 7) return 7.0;
  if (kmPerHour >= 6) return 6.0;
  return 5.0;
};

const sportMet = (sport = '', title = ''): number | undefined => {
  const text = sport + title;
  if (/力量|器械|核心|strength|training/i.test(text)) return 5.0;
  if (/骑行|单车|cycling/i.test(text)) return 7.5;
  if (/游泳|swim/i.test(text)) return 8.0;
  if (/走|walk/i.test(text)) return 3.5;
  if (/休息|rest/i.test(text)) return 1.0;
  return undefined;
};

/** 估算一次活动消耗（千卡）：优先设备数值，其次心率公式，最后按配速/项目估。 */
export function activityCalories(activity: Activity, profile?: Profile | null): { kcal: number; source: string } {
  const measured = activity.detail?.calories;
  if (measured && measured > 0) return { kcal: Math.round(measured), source: '设备记录' };
  const minutes = activity.minutes > 0 ? activity.minutes : 0;
  const weight = profile?.weightKg ?? 65;
  if (!minutes) return { kcal: 0, source: '缺少时长' };

  // Keytel 心率公式（2005）：只知道平均心率时的经典估算
  if (profile && activity.averageHr && activity.averageHr > 60) {
    const kcalPerMin = profile.sex === '男'
      ? (-55.0969 + 0.6309 * activity.averageHr + 0.1988 * weight + 0.2017 * profile.age) / 4.184
      : (-20.4022 + 0.4472 * activity.averageHr - 0.1263 * weight + 0.074 * profile.age) / 4.184;
    if (kcalPerMin > 0) return { kcal: Math.round(kcalPerMin * minutes), source: '心率公式' };
  }

  const kmPerHour = activity.km > 0 ? (activity.km / minutes) * 60 : 0;
  const met = kmPerHour > 0 ? paceMet(kmPerHour) : (sportMet(activity.sport, activity.title) ?? 6.0);
  // MET 公式：千卡 = MET × 3.5 × 体重(kg) / 200 × 分钟
  return { kcal: Math.round((met * 3.5 * weight) / 200 * minutes), source: '配速估算' };
}

export type DailyCalories = {
  bmr: number;
  method: string;
  neat: number;
  exercise: number;
  maintenance: number;
  target: number;
  eaten: number;
  remaining: number;
  water: number;
  waterGoal: number;
  manualTarget: boolean;
};

const round = (value: number) => Math.round(value);
const sum = <T>(items: T[], pick: (item: T) => number) => items.reduce((total, item) => total + pick(item), 0);

export function waterGoalMl(profile?: Profile | null): number {
  if (profile?.waterGoalMl && profile.waterGoalMl > 0) return profile.waterGoalMl;
  return profile?.weightKg ? Math.round(profile.weightKg * 30) : 2000;
}

export function dailyCalories(input: {
  profile?: Profile | null;
  activities: Activity[];
  intake: IntakeEntry[];
  water: WaterEntry[];
  date: string;
}): DailyCalories | undefined {
  const { profile, activities, intake, water, date } = input;
  if (!profileIsComplete(profile)) return undefined;
  const bmr = basalMetabolicRate(profile);
  const neat = round(bmr.kcal * neatFactor(profile.activityLevel));
  const todayActivities = activities.filter((activity) => activity.date === date);
  const exercise = sum(todayActivities, (activity) => activityCalories(activity, profile).kcal);
  const maintenance = neat + exercise;

  const rate = profile.rateKgPerWeek ?? (profile.goal === '减脂' ? 0.5 : profile.goal === '增肌' ? 0.25 : 0);
  const adjustment = profile.goal === '维持' ? 0 : Math.round((rate * 7700) / 7) * (profile.goal === '减脂' ? -1 : 1);
  const formulaTarget = maintenance + adjustment;
  // 减脂不让目标低于基础代谢的 1.2 倍，避免不安全的极端节食
  const floor = profile.goal === '减脂' ? round(bmr.kcal * 1.2) : 0;
  const autoTarget = Math.max(formulaTarget, floor);
  const manualTarget = Boolean(profile.targetIntake && profile.targetIntake > 0);
  const target = manualTarget ? Math.round(profile.targetIntake!) : round(autoTarget);

  const eaten = round(sum(intake.filter((entry) => entry.date === date), (entry) => entry.kcal));
  const waterTotal = round(sum(water.filter((entry) => entry.date === date), (entry) => entry.ml));

  return {
    bmr: bmr.kcal, method: bmr.method, neat, exercise, maintenance, target,
    eaten, remaining: target - eaten, water: waterTotal, waterGoal: waterGoalMl(profile), manualTarget,
  };
}

export function roundKcal(value: number): number {
  return Math.round(value / 10) * 10;
}

/** 常见食物快捷项，用于「记一笔」 */
export const quickFoods: { label: string; kcal: number }[] = [
  { label: '鸡蛋 1 个', kcal: 70 },
  { label: '牛奶 250ml', kcal: 130 },
  { label: '香蕉 1 根', kcal: 90 },
  { label: '苹果 1 个', kcal: 80 },
  { label: '米饭 1 碗', kcal: 200 },
  { label: '面条 1 碗', kcal: 350 },
  { label: '鸡胸肉 100g', kcal: 120 },
  { label: '酸奶 1 杯', kcal: 120 },
];
