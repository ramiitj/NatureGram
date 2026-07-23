// W3: grants/revokes the `admin` custom claim that firestore.rules'
// isAdmin() and AdminConsole.tsx now check, replacing the previous
// hardcoded single admin email. Requires Application Default Credentials
// or GOOGLE_APPLICATION_CREDENTIALS for the target Firebase project (the
// same requirement the server's Admin SDK already has) — there is no way
// to set a custom claim from the client SDK, by design.
//
// Usage:
//   tsx scripts/manageAdminRole.ts grant <email>
//   tsx scripts/manageAdminRole.ts revoke <email>
//   tsx scripts/manageAdminRole.ts list
import path from 'path';
import { fileURLToPath } from 'url';
import { getAuth } from 'firebase-admin/auth';
import { initFirebaseAdmin } from '../server/lib/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..');

async function main() {
  const [, , command, emailArg] = process.argv;
  if (!command || !['grant', 'revoke', 'list'].includes(command)) {
    console.error('Usage: tsx scripts/manageAdminRole.ts <grant|revoke|list> [email]');
    process.exit(1);
  }

  const projectId = initFirebaseAdmin(REPO_ROOT);
  if (!projectId) {
    console.error('Could not resolve a Firebase project ID from firebase-applet-config.json — refusing to run a role-management operation against ambient/default credentials.');
    process.exit(1);
  }

  if (command === 'list') {
    let nextPageToken: string | undefined;
    let found = 0;
    do {
      const page = await getAuth().listUsers(1000, nextPageToken);
      for (const user of page.users) {
        if ((user.customClaims as Record<string, unknown> | undefined)?.admin === true) {
          console.log(`${user.email || '(no email)'} (uid: ${user.uid})`);
          found++;
        }
      }
      nextPageToken = page.pageToken;
    } while (nextPageToken);
    console.log(found === 0 ? 'No accounts currently hold the admin claim.' : `${found} account(s) hold the admin claim.`);
    return;
  }

  if (!emailArg) {
    console.error(`Usage: tsx scripts/manageAdminRole.ts ${command} <email>`);
    process.exit(1);
  }

  const user = await getAuth().getUserByEmail(emailArg);
  const existingClaims = (user.customClaims as Record<string, unknown> | undefined) || {};

  if (command === 'grant') {
    await getAuth().setCustomUserClaims(user.uid, { ...existingClaims, admin: true });
    console.log(`Granted the admin claim to ${emailArg} (uid: ${user.uid}). They must sign out and back in (or otherwise force a token refresh) for it to take effect.`);
  } else {
    const rest = { ...existingClaims };
    delete rest.admin;
    await getAuth().setCustomUserClaims(user.uid, rest);
    console.log(`Revoked the admin claim from ${emailArg} (uid: ${user.uid}).`);
  }
}

main().catch((e) => {
  console.error('Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
