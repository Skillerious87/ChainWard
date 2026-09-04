"use client";

import Image from "next/image";
import { useState } from "react";

const DEFAULT_PROFILE_IMAGE = "/images/default-profile-avatar.webp";

export function UserAvatar({
  className,
  imageUrl,
  name,
  size,
}: {
  className?: string;
  imageUrl?: string | null;
  name: string;
  size: number;
}) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const useFallback = !imageUrl || failedImageUrl === imageUrl;
  const source = useFallback ? DEFAULT_PROFILE_IMAGE : imageUrl;

  return (
    <Image
      alt={`${name} profile picture`}
      className={className}
      draggable={false}
      height={size}
      loading="eager"
      onError={() => {
        if (imageUrl) setFailedImageUrl(imageUrl);
      }}
      referrerPolicy="no-referrer"
      sizes={`${size}px`}
      src={source}
      unoptimized
      width={size}
    />
  );
}
