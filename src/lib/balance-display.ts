export type BalanceView = {
  debt: number;
  credit: number;
  hasCredit: boolean;
};

export function getBalanceView(value: unknown): BalanceView {
  const raw = Number(value);
  const balance = Number.isFinite(raw) ? raw : 0;
  return {
    debt: Math.max(balance, 0),
    credit: Math.max(-balance, 0),
    hasCredit: balance < 0
  };
}

export function formatBalanceState(value: unknown, unit = "") {
  const { debt, credit, hasCredit } = getBalanceView(value);
  const suffix = unit ? ` ${unit}` : "";
  return hasCredit ? `欠款 0${suffix}；抵扣额度 ${credit}${suffix}` : `欠款 ${debt}${suffix}`;
}
