// X1: manages the custom claims that gate elevated capabilities —
// generalizes W3's admin-only script to any role. Two roles today:
//   - admin  : platform administration (firestore.rules isAdmin(),
//              AdminConsole, UserProfile admin link)
//   - expert : a qualified naturalist whose verification carries expert
//              weight and can promote an ID to research-grade (X1/X2,
//              reputationService.getVerificationWeight)
//
// Custom claims are server-only by design (no client SDK can set them),
// embedded in the signed ID token, so they can't be spoofed. Requires
// Application Default Credentials / GOOGLE_APPLICATION_CREDENTIALS for the
// project, same as the server's Admin SDK.
//
// Usage:
//   tsx scripts/manageRoles.ts grant  <admin|expert> <email>
//   tsx scripts/manageRoles.ts revoke <admin|expert> <email>
//   tsx scripts/manageRoles.ts list   <admin|expert>
import path from 'path';
import { fileURLToPath } from 'url';
import { getAuth } from 'firebase-admin/auth';
import { initFirebaseAdmin } from '../server/lib/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..');

const VALID_ROLES = ['admin', 'expert'] as const;
type Role = typeof VALID_ROLES[number];

function usage(): never {
  console.error('Usage:\n  tsx scripts/manageRoles.ts grant  <admin|expert> <email>\n  tsx scripts/manageRoles.ts revoke <admin|expert> <email>\n  tsx scripts/manageRoles.ts list   <admin|expert>');
  process.exit(1);
}

async function main() {
  const [, , command, roleArg, emailArg] = process.argv;
  if (!command || !['grant', 'revoke', 'list'].includes(command)) usage();
  if (!roleArg || !VALID_ROLES.includes(roleArg as Role)) usage();
  const role = roleArg as Role;

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
        if ((user.customClaims as Record<string, unknown> | undefined)?.[role] === true) {
          console.log(`${user.email || '(no email)'} (uid: ${user.uid})`);
          found++;
        }
      }
      nextPageToken = page.pageToken;
    } while (nextPageToken);
    console.log(found === 0 ? `No accounts currently hold the ${role} claim.` : `${found} account(s) hold the ${role} claim.`);
    return;
  }

  if (!emailArg) usage();

  const user = await getAuth().getUserByEmail(emailArg);
  const existingClaims = (user.customClaims as Record<string, unknown> | undefined) || {};

  if (command === 'grant') {
    await getAuth().setCustomUserClaims(user.uid, { ...existingClaims, [role]: true });
    console.log(`Granted the ${role} claim to ${emailArg} (uid: ${user.uid}). They must sign out and back in (or otherwise force a token refresh) for it to take effect.`);
  } else {
    const rest = { ...existingClaims };
    delete rest[role];
    await getAuth().setCustomUserClaims(user.uid, rest);
    console.log(`Revoked the ${role} claim from ${emailArg} (uid: ${user.uid}).`);
  }
}

main().catch((e) => {
  console.error('Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
