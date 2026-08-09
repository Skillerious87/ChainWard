import Image from "next/image";
import chainwardLogo from "../../ChainWardLogo.png";

interface BrandMarkProps {
  compact?: boolean;
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div className="brand" aria-label="Chainward home">
      <Image className="brand__mark brand__mark--image" src={chainwardLogo} alt="" aria-hidden="true" draggable={false} width={33} height={41} priority />
      {!compact && (
        <span className="brand__wordmark">
          Chain<span>ward</span>
        </span>
      )}
    </div>
  );
}
