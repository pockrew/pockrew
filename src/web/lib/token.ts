/**
 * Stream and report token parsed from location.hash (#token=...).
 * URL fragments never reach server logs, keeping local tokens private.
 */
export const parseToken = (hash: string): string | null => {
  const match = /(?:^|[#&])token=([^&]+)/.exec(hash);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

export const getStreamToken = (): string | null => {
  if (typeof location === "undefined") return null;
  return parseToken(location.hash);
};
