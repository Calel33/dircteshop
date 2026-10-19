import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import type { WebhookEvent } from '@clerk/backend';
import { Webhook } from 'svix';
import { transformWebhookData } from './paymentAttemptTypes';
import {
  UPLOAD_PATH,
  uploadPhoto,
  uploadPhotoOptions,
} from './businesses/photoUploads';

const http = httpRouter();

http.route({
  path: '/clerk-users-webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const event = await validateRequest(request);
    if (!event) {
      return new Response('Error occured', { status: 400 });
    }
    switch (event.type) {
      case 'user.created': // intentional fallthrough
      case 'user.updated':
        await ctx.runMutation(internal.users.upsertFromClerk, {
          data: event.data,
        });
        break;

      case 'user.deleted': {
        const clerkUserId = event.data.id!;
        await ctx.runMutation(internal.users.deleteFromClerk, { clerkUserId });
        break;
      }

      case 'paymentAttempt.updated': {
        // Clerk's webhook payload type omits fields that are sent at runtime
        // (e.g. invoice_id); the Convex validator enforces the real contract
        // when the mutation runs.
        const paymentAttemptData = transformWebhookData(
          event.data as unknown as Parameters<typeof transformWebhookData>[0],
        );
        await ctx.runMutation(internal.paymentAttempts.savePaymentAttempt, {
          paymentAttemptData,
        });
        break;
      }

      default:
        console.log('Ignored webhook event', event.type);
    }

    return new Response(null, { status: 200 });
  }),
});

// B7 (issue #7): the only path that mints an ownership row for a storage id.
// `generateUploadUrl` was removed because a raw POST to its URL bypasses the
// registry and would only produce ids the attach gate must reject.
http.route({ path: UPLOAD_PATH, method: 'POST', handler: uploadPhoto });
http.route({ path: UPLOAD_PATH, method: 'OPTIONS', handler: uploadPhotoOptions });

async function validateRequest(req: Request): Promise<WebhookEvent | null> {
  const payloadString = await req.text();
  const svixHeaders = {
    'svix-id': req.headers.get('svix-id')!,
    'svix-timestamp': req.headers.get('svix-timestamp')!,
    'svix-signature': req.headers.get('svix-signature')!,
  };
  const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET!);
  try {
    // svix v2: verify() throws on failure and returns undefined on success
    // (v1 returned the parsed payload), so parse the verified body ourselves.
    wh.verify(payloadString, svixHeaders);
    return JSON.parse(payloadString) as WebhookEvent;
  } catch (error) {
    console.error('Error verifying webhook event', error);
    return null;
  }
}

export default http;
