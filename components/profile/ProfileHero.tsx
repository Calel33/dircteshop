import { ImageIcon } from 'lucide-react';

import type { BusinessPhoto } from './profile-types';

export type ProfileHeroProps = {
  businessName: string;
  photos: readonly BusinessPhoto[];
  /**
   * Storage URLs keyed by storage id, resolved by the caller. Photos without a
   * resolved URL (and the empty case) render a token-styled placeholder.
   */
  photoUrls?: Readonly<Record<string, string>>;
};

function resolvePhotoUrl(
  photo: BusinessPhoto,
  photoUrls: Readonly<Record<string, string>> | undefined,
): string | undefined {
  if (photoUrls === undefined) {
    return undefined;
  }

  return photoUrls[photo.storageId];
}

/** Gallery hero; renders a placeholder when the business has no photos. */
export function ProfileHero({ businessName, photos, photoUrls }: ProfileHeroProps) {
  const ordered = [...photos].sort((a, b) => a.ordering - b.ordering);

  if (ordered.length === 0) {
    return (
      <div className="bg-muted text-muted-foreground flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border">
        <ImageIcon aria-hidden className="size-10" />
        <p className="font-mono text-xs tracking-wide uppercase">{businessName}</p>
      </div>
    );
  }

  const gridClassName =
    ordered.length === 1 ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-2 gap-2 sm:grid-cols-3';

  return (
    <div className={gridClassName}>
      {ordered.map((photo) => {
        const url = resolvePhotoUrl(photo, photoUrls);

        return (
          <div
            key={photo.storageId}
            className="bg-muted relative aspect-square overflow-hidden rounded-lg border"
          >
            {url === undefined ? (
              <div className="text-muted-foreground flex size-full items-center justify-center">
                <ImageIcon aria-hidden className="size-6" />
              </div>
            ) : (
              <img
                src={url}
                alt={photo.altText ?? businessName}
                className="size-full object-cover"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
