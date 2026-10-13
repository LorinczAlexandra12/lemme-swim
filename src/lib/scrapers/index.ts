/**
 * A scraper-keretrendszer belépési pontja.
 *
 * Az adapterek IMPORTÁLÁSA a bejegyzésük: minden adapter-modul a betöltésekor
 * meghívja a `registerAdapter`-t. Új forrás bekötéséhez elég ide egy import.
 *
 * MIÉRT ENNYI ADAPTER VAN ÖSSZESEN? Mert a budapesti uszodák túlnyomó része
 * egyáltalán nem publikál gépi olvasású sávbeosztást (lásd `data/README.md`).
 * Amelyik igen, annak mind külön, kézzel írt értelmezőre van szüksége — közös
 * séma, szabvány vagy API sehol nincs.
 */

import './adapters/bvsc-facilitypilot';
import './adapters/csepel-palyabeosztas';
import './adapters/tuskecsarnok-szabad-vizfelulet';
import './adapters/tve-heti-program';
import './adapters/ujhegyi-palyabeosztas';
import './adapters/pesterzsebeti-savbeosztas';
import './adapters/uszodak16-szabad-palyak';

export { listAdapters, getAdapter, registerAdapter, clearAdapters } from './types';
export type { Adapter, ParseContext, RawSource } from './types';
export { runAdapter, runAdapters } from './runner';
export { fetchRaw, asText, robotsAllows, USER_AGENT, CACHE_DIR } from './http';
