import React from 'react';
import {Composition} from 'remotion';
import {Short, ShortProps} from './Short';

const FPS = 30;

const defaultProps: ShortProps = {
  headline: 'Template test headline',
  source: 'Source: example',
  audio: '',
  words: [],
  durationSec: 10,
  images: [],
  music: '',
};

export const Root: React.FC = () => {
  return (
    <Composition
      id="Short"
      component={Short}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={FPS * 10}
      defaultProps={defaultProps}
      calculateMetadata={({props}) => ({
        durationInFrames: Math.max(1, Math.ceil(props.durationSec * FPS)),
      })}
    />
  );
};
