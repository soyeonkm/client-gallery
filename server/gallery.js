// Every gallery needs a photographer name: clients see it, and it's part of every watermark
export const photographerNameError = (name) =>
  typeof name === 'string' && name.trim() ? null : 'Photographer name is required.';
