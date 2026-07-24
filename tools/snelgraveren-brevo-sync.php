<?php
/**
 * Plugin Name: Snelgraveren → Brevo sync (Freemius webhook)
 * Description: Receives Freemius webhooks and upserts the user into a Brevo contact list. New installs (marketing opt-in) are tagged PLAN=free; purchases flip PLAN=pro. Standalone — NOT part of the ProductForge plugin.
 * Author: Martin Temmink
 * Version: 1.0.0
 *
 * DEPLOY: drop this file in  wp-content/mu-plugins/  on snelgraveren.nl
 * (create the mu-plugins folder if it doesn't exist — mu-plugins auto-activate).
 *
 * WEBHOOK URL to register in Freemius (Dashboard → your product → Settings →
 * Webhooks, or the Webhooks section):
 *     https://www.snelgraveren.nl/wp-json/sgpd-brevo/v1/webhook
 *
 * ── FILL IN THESE THREE VALUES ─────────────────────────────────────────────
 */
defined('ABSPATH') || exit;

// Brevo → Settings → SMTP & API → API Keys
const SGPD_BREVO_API_KEY = 'PASTE_YOUR_BREVO_API_KEY';
// Brevo → Contacts → your list → the numeric List ID (shown in the URL / list settings)
const SGPD_BREVO_LIST_ID = 0;            // e.g. 3
// Freemius → Developer Dashboard → your product → Settings → Secret Key
const SGPD_FS_SECRET_KEY = 'PASTE_YOUR_FREEMIUS_SECRET_KEY';
// ───────────────────────────────────────────────────────────────────────────

add_action('rest_api_init', function () {
    register_rest_route('sgpd-brevo/v1', '/webhook', [
        'methods'             => 'POST',
        'callback'            => 'sgpd_brevo_handle_webhook',
        // Public endpoint — authenticity is enforced by the Freemius X-Signature
        // HMAC check inside the callback, not by a WP capability.
        'permission_callback' => '__return_true',
    ]);
});

/**
 * Verify the Freemius signature, then sync the user to Brevo.
 * Always returns HTTP 200 so we never leak validation details to attackers
 * (Freemius best practice) and Freemius doesn't retry on our rejections.
 */
function sgpd_brevo_handle_webhook(WP_REST_Request $request) {
    $raw = $request->get_body();

    // 1) Authenticity: X-Signature = hash_hmac('sha256', raw_body, product_secret_key)
    $expected  = hash_hmac('sha256', $raw, SGPD_FS_SECRET_KEY);
    $signature = (string) $request->get_header('x-signature');
    if (!$signature || !hash_equals($expected, $signature)) {
        sgpd_brevo_log('rejected: bad signature');
        return new WP_REST_Response(null, 200);
    }

    $event = json_decode($raw, true);
    if (!is_array($event) || empty($event['type'])) {
        return new WP_REST_Response(null, 200);
    }

    $type = $event['type'];
    $user = $event['objects']['user'] ?? [];
    $email = isset($user['email']) ? sanitize_email($user['email']) : '';

    // No e-mail = the user skipped the marketing opt-in → nothing to sync.
    if (!$email || !is_email($email)) {
        return new WP_REST_Response(null, 200);
    }

    $first = isset($user['first']) ? sanitize_text_field($user['first']) : '';
    $last  = isset($user['last'])  ? sanitize_text_field($user['last'])  : '';

    if ($type === 'install.installed') {
        // New (opted-in) free user. Create with PLAN=free; if they already
        // exist (e.g. an existing paying customer reinstalling) only refresh
        // name + list membership so we never downgrade PLAN pro → free.
        sgpd_brevo_upsert_free($email, $first, $last);
    } elseif ($type === 'license.created') {
        // Purchase → make sure the contact exists and is tagged PLAN=pro.
        sgpd_brevo_set_pro($email, $first, $last);
    }
    // Other event types are ignored on purpose.

    return new WP_REST_Response(null, 200);
}

/** Create the contact as PLAN=free; on "already exists" just update name+list. */
function sgpd_brevo_upsert_free($email, $first, $last) {
    $created = sgpd_brevo_request('POST', 'https://api.brevo.com/v3/contacts', [
        'email'         => $email,
        'attributes'    => array_filter([
            'FIRSTNAME' => $first,
            'LASTNAME'  => $last,
            'PLAN'      => 'free',
        ]),
        'listIds'       => [SGPD_BREVO_LIST_ID],
        'updateEnabled' => false, // create-only, so we don't clobber an existing PLAN
    ]);

    // 400 "Contact already exist" → update name + list WITHOUT touching PLAN.
    if ($created === 400) {
        sgpd_brevo_request('PUT', 'https://api.brevo.com/v3/contacts/' . rawurlencode($email), [
            'attributes' => array_filter([
                'FIRSTNAME' => $first,
                'LASTNAME'  => $last,
            ]),
            'listIds'    => [SGPD_BREVO_LIST_ID],
        ]);
    }
}

/** Upsert the contact and set PLAN=pro (idempotent). */
function sgpd_brevo_set_pro($email, $first, $last) {
    $status = sgpd_brevo_request('POST', 'https://api.brevo.com/v3/contacts', [
        'email'         => $email,
        'attributes'    => array_filter([
            'FIRSTNAME' => $first,
            'LASTNAME'  => $last,
            'PLAN'      => 'pro',
        ]),
        'listIds'       => [SGPD_BREVO_LIST_ID],
        'updateEnabled' => true, // create or update — we DO want PLAN=pro to win
    ]);
    if ($status >= 400 && $status !== 400) {
        sgpd_brevo_log("brevo set_pro failed ($status) for $email");
    }
}

/**
 * Fire a Brevo API request. Returns the HTTP status code (int), or 0 on a
 * transport error. Never throws — a marketing sync must not break checkout.
 */
function sgpd_brevo_request($method, $url, array $body) {
    $res = wp_remote_request($url, [
        'method'  => $method,
        'timeout' => 8,
        'headers' => [
            'api-key'      => SGPD_BREVO_API_KEY,
            'accept'       => 'application/json',
            'content-type' => 'application/json',
        ],
        'body'    => wp_json_encode($body),
    ]);
    if (is_wp_error($res)) {
        sgpd_brevo_log('brevo transport error: ' . $res->get_error_message());
        return 0;
    }
    return (int) wp_remote_retrieve_response_code($res);
}

/** Lightweight debug log (only when WP_DEBUG is on). */
function sgpd_brevo_log($msg) {
    if (defined('WP_DEBUG') && WP_DEBUG) {
        error_log('[sgpd-brevo] ' . $msg);
    }
}
