export default function Logo({ size = 38 }: { size?: number }) {
  return (
    <span className="logo-wrap" aria-label="BMG Build Market Group">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.svg" width={size} height={size} alt="" />
      <span className="logo-text"><b>BMG</b><small>Build Market Group</small></span>
    </span>
  );
}
