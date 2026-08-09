interface SparklineProps {
  values: readonly number[];
  label: string;
}

export function Sparkline({ values, label }: SparklineProps) {
  const maximum = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
      const y = 38 - (value / maximum) * 32;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      className="sparkline"
      viewBox="0 0 100 40"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <path className="sparkline__area" d={`M0,40 L${points} L100,40 Z`} />
      <polyline className="sparkline__line" points={points} />
    </svg>
  );
}
