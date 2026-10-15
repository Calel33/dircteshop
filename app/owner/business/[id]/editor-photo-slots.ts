/** Photo-grid labels shown by the owner editor's placeholder gallery. */
export function getPhotoSlotLabels(photoCount: number): string[] {
  const slotCount = Math.max(photoCount, 3);

  return Array.from({ length: slotCount }, (_, index) =>
    index < photoCount ? `Photo ${index + 1}` : '+'
  );
}
