"use client";

import Image from "next/image";
import { Suspense, use, useState } from "react";

const DEFAULT_PROFILE_IMAGE = "/images/default-profile-avatar.webp";

interface UserAvatarProps {
  className?: string;
  imageUrl?: string | null;
  name: string;
  size: number;
}

/** A slow display-only refresh suspends only the avatar, never the workspace. */
export function UserAvatar({ imageUrlPromise, ...props }: UserAvatarProps & { imageUrlPromise?: Promise<string | null> }) {
  return imageUrlPromise
    ? <Suspense fallback={<AvatarImage {...props} />}><RefreshedAvatar {...props} imageUrlPromise={imageUrlPromise} /></Suspense>
    : <AvatarImage {...props} />;
}

function RefreshedAvatar({ imageUrlPromise, ...props }: UserAvatarProps & { imageUrlPromise: Promise<string | null> }) {
  const imageUrl = use(imageUrlPromise);
  return <AvatarImage {...props} imageUrl={imageUrl} />;
}

function AvatarImage({ className, imageUrl, name, size }: UserAvatarProps) {
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
