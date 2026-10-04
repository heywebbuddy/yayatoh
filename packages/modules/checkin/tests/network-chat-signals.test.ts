import { describe, expect, it } from 'vitest';
import { networkChatSignal } from '../src/network-chat-signals.ts';

describe('networkChatSignal (M5.8b chat reports → chat_abuse)', () => {
  it('maps every networking reason to a chat_abuse signal and the M1.9e reason vocabulary', () => {
    expect(networkChatSignal('harassment')).toEqual({
      kind: 'chat_abuse',
      severity: 'high',
      reason: 'abuse',
    });
    expect(networkChatSignal('inappropriate')).toEqual({
      kind: 'chat_abuse',
      severity: 'high',
      reason: 'abuse',
    });
    expect(networkChatSignal('spam')).toEqual({ kind: 'chat_abuse', severity: 'medium', reason: 'spam' });
    expect(networkChatSignal('fake')).toEqual({ kind: 'chat_abuse', severity: 'medium', reason: 'other' });
    expect(networkChatSignal('other')).toEqual({ kind: 'chat_abuse', severity: 'low', reason: 'other' });
  });
});
