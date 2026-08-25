import Image from "next/image";

interface BrandMarkProps {
  compact?: boolean;
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div className="brand" aria-label="Chainward home">
      <Image className="brand__mark brand__mark--image" src="/icons/chainward-mark.svg" alt="" aria-hidden="true" draggable={false} width={36} height={36} priority />
      {!compact && (
        <span className="brand__wordmark">
          Chain<span>ward</span>
        </span>
      )}
    </div>
  );
}
