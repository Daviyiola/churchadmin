export default function BrandLogo({
  size = 36,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/brand/logo.svg"
      alt="Church Admin"
      width={size}
      height={size}
      className={`object-contain ${className}`}
    />
  );
}
