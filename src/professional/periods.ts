/* Calendar periods in "YYYY-MM-DD" / "YYYY-MM" / "YYYY-Qn" form, shared by
   the professional engines. */

const pad = (n: number) => String(n).padStart(2, "0");
export const monthStart = (m: string) => `${m}-01`;
export const monthEnd = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};
export const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`;
};
export const quarterOf = (date: string) => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
export const quarterMonths = (q: string) => {
  const y = q.slice(0, 4);
  const n = Number(q.slice(6));
  return [1, 2, 3].map((k) => `${y}-${pad((n - 1) * 3 + k)}`);
};
export const nextQuarter = (q: string) => {
  const y = Number(q.slice(0, 4));
  const n = Number(q.slice(6));
  return n === 4 ? `${y + 1}-Q1` : `${y}-Q${n + 1}`;
};
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export const prevQuarter = (q: string) => {
  const y = Number(q.slice(0, 4));
  const n = Number(q.slice(6));
  return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`;
};
