import admin from 'firebase-admin';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { BigQuery } from '@google-cloud/bigquery';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

// The Firestore/gRPC client's own background reconnection logic can reject
// promises outside the call chain a plain try/catch around
// fetchConfirmedObservations would see — without this, a missing-ADC
// environment crashes with a raw stack trace instead of the clear message
// below. This is the same "fail with an honest explanation, not a crash"
// posture as everywhere else credentials might be absent in this project.
process.on('unhandledRejection', (err: any) => {
    console.error('[warehouse] Could not reach Firestore/BigQuery:', err?.message || err);
    console.error('[warehouse] This needs working Google Cloud Application Default Credentials — see warehouse/README.md.');
    process.exit(1);
});

// T2: research warehouse export. Firestore documents can't do
// species x place x time analytical querying (no joins, no aggregation
// across the whole corpus) — this is what turns the verified-observation
// corpus this app collects into an actual research asset. Reuses the same
// firebase-applet-config.json / Application Default Credentials pattern
// server/lib/auth.js already uses, since this is a standalone script (not
// part of the Express server's own admin init).
const initAdmin = (): string | null => {
    try {
        const configPath = path.join(REPO_ROOT, 'firebase-applet-config.json');
        if (existsSync(configPath)) {
            const config = JSON.parse(readFileSync(configPath, 'utf8'));
            admin.initializeApp({ projectId: config.projectId });
            return config.projectId;
        }
        admin.initializeApp();
        return null;
    } catch (e) {
        console.error('[warehouse] Failed to initialize Firebase Admin:', e);
        return null;
    }
};

interface ObservationRow {
    observation_id: string;
    media_type: string | null;
    labels: string[];
    canonical_taxa: {
        gbif_key: number | null;
        scientific_name: string | null;
        canonical_name: string | null;
        rank: string | null;
        kingdom: string | null;
        phylum: string | null;
        class_name: string | null;
        order_name: string | null;
        family: string | null;
        genus: string | null;
    }[];
    confidence: string | null;
    verification_state: string | null;
    soundscape: { label: string; start_sec: number | null; end_sec: number | null; confidence: string | null }[];
    geohash: string | null;
    lat: number | null;
    lng: number | null;
    location_area: string | null;
    is_sensitive_species: boolean;
    observed_at: string | null;
}

// Only community-verified (verificationState === 'confirmed', see Q3)
// observations belong in a dataset meant to support a scientific claim —
// same "verified, not merely posted" bar the audio export (S3) already
// applies. Precise coordinates are withheld for sensitive species, same
// protection applied everywhere else this data surfaces.
const fetchConfirmedObservations = async (db: Firestore): Promise<ObservationRow[]> => {
    const snapshot = await db.collection('ecosystem_feed').where('verificationState', '==', 'confirmed').get();
    const rows: ObservationRow[] = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        const isSensitive = !!data.isSensitiveSpecies;
        rows.push({
            observation_id: doc.id,
            media_type: data.mediaType || null,
            labels: data.labels || [],
            canonical_taxa: (data.canonicalTaxa || []).map((t: any) => ({
                gbif_key: t.gbifKey ?? null,
                scientific_name: t.scientificName ?? null,
                canonical_name: t.canonicalName ?? null,
                rank: t.rank ?? null,
                kingdom: t.kingdom ?? null,
                phylum: t.phylum ?? null,
                class_name: t.class ?? null,
                order_name: t.order ?? null,
                family: t.family ?? null,
                genus: t.genus ?? null,
            })),
            confidence: data.confidence ?? null,
            verification_state: data.verificationState ?? null,
            soundscape: (data.soundscape || []).map((s: any) => ({
                label: s.label,
                start_sec: s.startSec ?? null,
                end_sec: s.endSec ?? null,
                confidence: s.confidence ?? null,
            })),
            geohash: data.geohash ?? null,
            lat: (!isSensitive && data.rawLocation) ? data.rawLocation.lat : null,
            lng: (!isSensitive && data.rawLocation) ? data.rawLocation.lng : null,
            location_area: data.locationArea ?? null,
            is_sensitive_species: isSensitive,
            observed_at: (data.timestamp && typeof data.timestamp.toDate === 'function') ? data.timestamp.toDate().toISOString() : null,
        });
    });
    return rows;
};

const loadIntoBigQuery = async (ndjsonPath: string, projectId: string, datasetId: string, tableId: string, schema: any[]) => {
    const bigquery = new BigQuery({ projectId });
    const dataset = bigquery.dataset(datasetId);
    const [datasetExists] = await dataset.exists();
    if (!datasetExists) {
        await dataset.create();
        console.log(`[warehouse] Created dataset ${datasetId}`);
    }
    const table = dataset.table(tableId);
    const [tableExists] = await table.exists();
    if (!tableExists) {
        await dataset.createTable(tableId, { schema });
        console.log(`[warehouse] Created table ${tableId} from warehouse/schema.json`);
    }
    const [job] = await table.load(ndjsonPath, {
        sourceFormat: 'NEWLINE_DELIMITED_JSON',
        writeDisposition: 'WRITE_APPEND',
    });
    console.log(`[warehouse] BigQuery load job ${job.id} completed — ${job.status?.state}`);
};

const main = async () => {
    const projectIdFromAdmin = initAdmin();
    const db = getFirestore();

    console.log('[warehouse] Fetching community-verified observations from Firestore...');
    let rows: ObservationRow[];
    try {
        rows = await fetchConfirmedObservations(db);
    } catch (e: any) {
        console.error('[warehouse] Could not read from Firestore:', e.message);
        console.error('[warehouse] This needs working Google Cloud Application Default Credentials with Firestore access — see warehouse/README.md.');
        process.exitCode = 1;
        return;
    }
    console.log(`[warehouse] Found ${rows.length} verified observation(s).`);

    const exportsDir = path.join(__dirname, 'exports');
    if (!existsSync(exportsDir)) mkdirSync(exportsDir, { recursive: true });
    const ndjsonPath = path.join(exportsDir, `observations-${new Date().toISOString().slice(0, 10)}.ndjson`);
    writeFileSync(ndjsonPath, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    console.log(`[warehouse] Wrote ${ndjsonPath}`);

    const bqProjectId = process.env.BIGQUERY_PROJECT_ID || projectIdFromAdmin;
    const datasetId = process.env.BIGQUERY_DATASET;
    const tableId = process.env.BIGQUERY_TABLE || 'observations';

    if (!datasetId) {
        console.log('[warehouse] BIGQUERY_DATASET not set — skipping the BigQuery load. The NDJSON file above is the deliverable for now.');
        console.log('[warehouse] Once a BigQuery project exists, either set BIGQUERY_DATASET (and re-run) or load it manually:');
        console.log(`  bq load --source_format=NEWLINE_DELIMITED_JSON --schema=warehouse/schema.json ${bqProjectId || '<PROJECT_ID>'}:<DATASET>.${tableId} ${ndjsonPath}`);
        return;
    }

    try {
        const schema = JSON.parse(readFileSync(path.join(__dirname, 'schema.json'), 'utf8'));
        if (!bqProjectId) throw new Error('No project ID available (set BIGQUERY_PROJECT_ID or firebase-applet-config.json)');
        await loadIntoBigQuery(ndjsonPath, bqProjectId, datasetId, tableId, schema);
    } catch (e: any) {
        console.error('[warehouse] BigQuery load failed:', e.message);
        console.log('[warehouse] The NDJSON export above is still valid and can be loaded manually — see warehouse/README.md.');
        process.exitCode = 1;
    }
};

main();
