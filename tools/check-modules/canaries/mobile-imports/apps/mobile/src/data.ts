// Canary: an app must not reach the database, a module, Next or the DOM renderer (ADR 0025).
import { readFileSync } from 'node:fs';
import { db } from '@yayatoh/db';
import { events } from '@yayatoh/events';
import { redirect } from 'next/navigation';
import { createPortal } from 'react-dom';

export const leak = [db, events, redirect, createPortal, readFileSync];
