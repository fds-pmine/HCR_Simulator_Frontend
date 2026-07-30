import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHALLENGE_ID } from '../../data/challenges/defaultChallenge';
import { LocalChallengeProvider } from '../../services/local/LocalChallengeProvider';
import { LocalScoreProvider } from '../../services/local/LocalScoreProvider';
import { SimulationEngine } from './SimulationEngine';
import { SimulatorCanvas } from './SimulatorCanvas';

describe('SimulatorCanvas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an actionable fallback when WebGL is unavailable', async () => {
    vi.spyOn(
      HTMLCanvasElement.prototype,
      'getContext',
    ).mockReturnValue(null);
    const challenge = await new LocalChallengeProvider().getChallenge(
      DEFAULT_CHALLENGE_ID,
    );
    const engine = new SimulationEngine(
      challenge,
      new LocalScoreProvider(),
    );

    render(<SimulatorCanvas engine={engine} showTarget />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This browser does not support WebGL',
    );
  });
});
