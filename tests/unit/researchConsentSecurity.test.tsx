import { useEffect, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { loadIdentity, saveIdentity } from '../../src/features/match/identity';
import { DataConsentDialog } from '../../src/features/preferences/DataConsentDialog';
import { ResearchParticipationGate } from '../../src/features/preferences/ResearchParticipationGate';
import { loadResearchPreferences, researchHeaders, resetResearchParticipation } from '../../src/features/preferences/researchPreferences';

const previousIdentity = { playerId: 'previous-player', displayName: 'Previous Student' };

describe('research consent and shared computers', () => {
  it('mounts no provider or identity until a fresh participant consents', () => {
    localStorage.removeItem('hcr.identity.v1');
    localStorage.removeItem('hcr.research-preferences.v1');
    const request = vi.fn();
    function Participant() {
      useState(loadIdentity);
      useEffect(() => { request(); }, []);
      return <p>Participating</p>;
    }
    render(<ResearchParticipationGate><Participant /></ResearchParticipationGate>);
    expect(request).not.toHaveBeenCalled();
    expect(localStorage.getItem('hcr.identity.v1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Participate in the academic study' }));
    expect(request).toHaveBeenCalledOnce();
    expect(localStorage.getItem('hcr.identity.v1')).not.toBeNull();
  });

  it('keeps saved optional fields disabled when participation is re-confirmed', () => {
    render(<DataConsentDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Participate in the academic study' }));
    expect(JSON.parse(localStorage.getItem('hcr.research-preferences.v1') ?? '{}')).toEqual({
      programAndScores: true, language: false, utcOffset: false, decided: true,
    });
  });

  it('withdraws and removes identity before a fresh consent mints the next identity', () => {
    saveIdentity(previousIdentity);
    function Participant() {
      const [identity] = useState(loadIdentity);
      return <><p>{identity.playerId}</p><DataConsentDialog onClose={() => {}} /></>;
    }
    render(<ResearchParticipationGate><Participant /></ResearchParticipationGate>);
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(localStorage.getItem('hcr.identity.v1')).toBeNull();
    expect(screen.queryByText(previousIdentity.playerId)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'You chose not to participate' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review study information' }));
    expect(localStorage.getItem('hcr.identity.v1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Participate in the academic study' }));
    expect(JSON.parse(localStorage.getItem('hcr.identity.v1') ?? '{}').playerId).not.toBe(previousIdentity.playerId);
  });

  it('withdraws in the current tab when persisting the declined choice fails', () => {
    saveIdentity(previousIdentity);
    const view = render(<ResearchParticipationGate><DataConsentDialog onClose={() => {}} /></ResearchParticipationGate>);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage quota exceeded');
    });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
      expect(write).toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: 'You chose not to participate' })).toBeInTheDocument();
      expect(loadResearchPreferences().programAndScores).toBe(false);
      expect(researchHeaders()['X-HCR-Research-Program-And-Scores']).toBe('declined');
      expect(localStorage.getItem('hcr.identity.v1')).toBeNull();
      expect(localStorage.getItem('hcr.research-preferences.v1')).toBeNull();
    } finally {
      write.mockRestore();
      view.unmount();
      resetResearchParticipation();
    }
  });

  it('clears the previous identity and consent with the menu New player action', () => {
    saveIdentity(previousIdentity);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'New player / not you?' }));
    expect(localStorage.getItem('hcr.identity.v1')).toBeNull();
    expect(localStorage.getItem('hcr.research-preferences.v1')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'HCR Simulator' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Academic research participation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Participate in the academic study' }));
    expect(JSON.parse(localStorage.getItem('hcr.identity.v1') ?? '{}').playerId).not.toBe(previousIdentity.playerId);
    expect(screen.getByRole('heading', { name: 'HCR Simulator' })).toBeInTheDocument();
  });
});
