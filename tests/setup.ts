import { mkdir, writeFile } from 'node:fs/promises';
import { encodeWav } from '../shared/audio';
import { tone } from './fixtures';
export default async function setup() {
  await mkdir('.local', { recursive: true });
  await writeFile('.local/microphone.wav', encodeWav(tone(65), 24000));
}
