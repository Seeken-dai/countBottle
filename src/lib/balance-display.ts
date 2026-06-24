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
  return hasCredit ? `待结 0${suffix}；可抵扣 ${credit}${suffix}` : `待结 ${debt}${suffix}`;
}
