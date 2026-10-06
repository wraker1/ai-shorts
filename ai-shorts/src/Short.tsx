import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {loadFont} from '@remotion/google-fonts/Anton';

const {fontFamily: ANTON} = loadFont();

export type Word = {text: string; start: number; end: number};

export type ShortProps = {
  headline: string;
  source: string;
  audio: string; // path inside /public, e.g. stories/my-story/voice.mp3
  words: Word[];
  durationSec: number;
  images: string[]; // paths inside /public
  music: string; // optional path inside /public, empty = no music
};

const HIGHLIGHT = '#FFD400';
const ACCENT = '#E50914';
const MAX_WORDS_PER_CHUNK = 3;
const MAX_CHARS_PER_CHUNK = 18;

type Chunk = {words: Word[]; start: number; end: number};

const buildChunks = (words: Word[], totalSec: number): Chunk[] => {
  const chunks: Chunk[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (current.length) {
      chunks.push({words: current, start: current[0].start, end: current[current.length - 1].end});
      current = [];
    }
  };
  for (const w of words) {
    const len = current.map((c) => c.text).join(' ').length + 1 + w.text.length;
    if (current.length && len > MAX_CHARS_PER_CHUNK) flush();
    current.push(w);
    if (current.length >= MAX_WORDS_PER_CHUNK || /[.!?,:;]$/.test(w.text)) flush();
  }
  flush();
  // close gaps so a caption is always on screen while speaking
  for (let i = 0; i < chunks.length; i++) {
    const next = chunks[i + 1];
    chunks[i].end = next ? next.start : Math.min(totalSec, chunks[i].end + 0.4);
  }
  return chunks;
};

const Background: React.FC<{src: string; index: number; length: number}> = ({src, index, length}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, length], [0, 1], {extrapolateRight: 'clamp'});
  const scale = 1.04 + progress * 0.14; // slow zoom in
  const dir = index % 2 === 0 ? 1 : -1;
  const x = (progress - 0.5) * 40 * dir; // slight drift
  const fade = interpolate(frame, [0, 6], [0, 1], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{opacity: fade, overflow: 'hidden', backgroundColor: '#000'}}>
      <Img
        src={staticFile(src)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `translateX(${x}px) scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};

const Placeholder: React.FC<{index: number; length: number}> = ({index, length}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, length], [0, 1], {extrapolateRight: 'clamp'});
  const palettes = [
    ['#1b1f3b', '#5b2a86'],
    ['#0f2027', '#2c5364'],
    ['#3a1c1c', '#8e2de2'],
    ['#10151f', '#1e6f5c'],
  ];
  const [a, b] = palettes[index % palettes.length];
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${160 + progress * 30}deg, ${a}, ${b})`,
        transform: `scale(${1 + progress * 0.1})`,
      }}
    />
  );
};

const Captions: React.FC<{chunks: Chunk[]}> = ({chunks}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const chunk = chunks.find((c) => t >= c.start && t < c.end);
  if (!chunk) return null;
  const local = (t - chunk.start) * fps;
  const pop = interpolate(local, [0, 4], [0.85, 1], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', paddingTop: 420}}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          columnGap: 26,
          width: '100%',
          boxSizing: 'border-box',
          padding: '0 70px',
          fontFamily: ANTON,
          fontSize: 118,
          lineHeight: 1.05,
          textTransform: 'uppercase',
          letterSpacing: 2,
          transform: `scale(${pop})`,
          WebkitTextStroke: '10px #000',
          paintOrder: 'stroke fill',
          textShadow: '0 8px 24px rgba(0,0,0,0.6)',
        }}
      >
        {chunk.words.map((w, i) => {
          const active = t >= w.start && t < w.end;
          return (
            <span key={i} style={{color: active ? HIGHLIGHT : '#fff'}}>
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Headline: React.FC<{headline: string}> = ({headline}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], {extrapolateRight: 'clamp'});
  return (
    <div
      style={{
        position: 'absolute',
        top: 170,
        left: 70,
        right: 70,
        opacity,
        color: '#fff',
        fontFamily: ANTON,
        fontSize: 78,
        lineHeight: 1.08,
        textTransform: 'uppercase',
        textShadow: '0 4px 18px rgba(0,0,0,0.85)',
      }}
    >
      {headline}
    </div>
  );
};

export const Short: React.FC<ShortProps> = ({headline, source, audio, words, durationSec, images, music}) => {
  const {fps, durationInFrames} = useVideoConfig();
  const chunks = React.useMemo(() => buildChunks(words, durationSec), [words, durationSec]);
  const count = Math.max(1, images.length);
  const seg = Math.ceil(durationInFrames / count);

  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      {Array.from({length: count}).map((_, i) => {
        const from = i * seg;
        const dur = i === count - 1 ? durationInFrames - from : seg;
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, dur)}>
            {images[i] ? <Background src={images[i]} index={i} length={dur} /> : <Placeholder index={i} length={dur} />}
          </Sequence>
        );
      })}

      {/* legibility gradients */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.7) 100%)',
        }}
      />

      <Headline headline={headline} />
      <Captions chunks={chunks} />

      {audio ? <Audio src={staticFile(audio)} /> : null}
      {music ? <Audio src={staticFile(music)} volume={0.12} loop /> : null}
    </AbsoluteFill>
  );
};
