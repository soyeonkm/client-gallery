// Light tan → coffee brown → ink as the save progresses
const PROGRESS_STOPS = [[201, 184, 166], [91, 66, 50], [28, 27, 25]];
export const progressColor = (t) => {
  const scaled = Math.min(Math.max(t, 0), 1) * (PROGRESS_STOPS.length - 1);
  const i = Math.min(Math.floor(scaled), PROGRESS_STOPS.length - 2);
  const f = scaled - i;
  const [a, b] = [PROGRESS_STOPS[i], PROGRESS_STOPS[i + 1]];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(', ')})`;
};

// Save responses are plain JSON, or (when watermarks need work) a stream of JSON lines:
// { progress: { done, total } } ... then { gallery } or { error }
export const readSaveResponse = async (res, onProgress) => {
  if (!res.headers.get('content-type')?.includes('ndjson')) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update settings');
    return data;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const message = JSON.parse(line);
      if (message.error) throw new Error(message.error);
      if (message.gallery) return message.gallery;
      if (message.progress) onProgress(message.progress.total ? message.progress.done / message.progress.total : 1);
    }
  }
  throw new Error('The save was interrupted. Please save again.');
};
