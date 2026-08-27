<?php
namespace Snelgraveren\ProductDesigner\Admin;

defined('ABSPATH') || exit;

use Snelgraveren\ProductDesigner\Database\DesignRepository;

/**
 * Saved designs, and the one action that could not be done from WP admin at
 * all: putting a design on a customer's name.
 *
 * WHY THIS EXISTS. A shop owner who designs something FOR a customer had no
 * way to hand it over. RestDesigns::create_design stamps the design with
 * get_current_user_id(), so an admin-drawn design belongs to the admin, and
 * ownership decides everything downstream: My Designs lists on customer_id,
 * the reopen link resolves through an ownership-checked REST route, and
 * Frontend::add_cart_item_data drops the hash SILENTLY when ownership fails —
 * the product lands in the cart with no design and no error. The only fix was
 * an UPDATE in phpMyAdmin.
 *
 * Plain server-rendered HTML rather than the React idiom used by the Template
 * Builder: each row carries its own form, which WP_List_Table fights, and a
 * screen this small should not need a build step to change.
 */
class DesignsPage {

    private const PAGE_SLUG = 'sgpd-designs';
    private const PER_PAGE  = 20;

    public function init(): void {
        add_action('admin_post_sgpd_assign_design', [$this, 'handle_assign']);
        add_action('admin_post_sgpd_proof_action', [$this, 'handle_proof_action']);
        add_action('admin_post_sgpd_delete_design', [$this, 'handle_delete']);
    }

    public function register_menu(): void {
        add_submenu_page(
            'sgpd-templates',
            __('Designs', 'snelgraveren-product-designer'),
            __('Designs', 'snelgraveren-product-designer'),
            'edit_sgpd_templates',
            self::PAGE_SLUG,
            [$this, 'render']
        );
    }

    /**
     * Resolve whatever the merchant typed into a user ID: a numeric ID, an
     * e-mail address, or a login name. Returns 0 when nothing matches.
     *
     * Deliberately not a customer dropdown: a shop with thousands of accounts
     * cannot render one, and the merchant already knows the address they just
     * mailed the proof to.
     */
    public static function resolve_customer(string $input): int {
        $input = trim($input);
        if ($input === '') {
            return 0;
        }

        if (ctype_digit($input)) {
            $user = get_user_by('id', (int) $input);
            return $user ? (int) $user->ID : 0;
        }

        $user = is_email($input) ? get_user_by('email', $input) : get_user_by('login', $input);
        return $user ? (int) $user->ID : 0;
    }

    /** Human-readable label for a `proof_status` value. Empty for anything unknown. */
    public static function proof_label(string $state): string {
        switch ($state) {
            case 'none':              return __('Not sent', 'snelgraveren-product-designer');
            case 'sent':              return __('Waiting for customer', 'snelgraveren-product-designer');
            case 'changes_requested': return __('Change requested', 'snelgraveren-product-designer');
            case 'approved':          return __('Approved', 'snelgraveren-product-designer');
            default:                  return '';
        }
    }

    /**
     * What to show in the proof e-mail field before the merchant types
     * anything: the address a proof was already sent to, or — the common
     * case, a design already assigned to a customer — that customer's
     * account e-mail, so sending a proof is one click instead of a
     * copy-paste round trip.
     */
    private function proof_email_prefill(array $design): string {
        if (!empty($design['proof_email'])) {
            return (string) $design['proof_email'];
        }
        $customer_id = (int) $design['customer_id'];
        if ($customer_id > 0) {
            $user = get_user_by('id', $customer_id);
            if ($user) {
                return $user->user_email;
            }
        }
        return '';
    }

    /**
     * The link the customer opens. The designer auto-loads the design from the
     * pf_design parameter; ownership is enforced when it fetches the data, so
     * the link is safe to mail but useless to anyone else.
     */
    public static function reopen_url(array $design): string {
        $permalink = get_permalink((int) $design['product_id']);
        if (!$permalink) {
            return '';
        }
        return add_query_arg('pf_design', $design['design_hash'], $permalink);
    }

    /**
     * The list URL a handler should redirect back to: the page, filters and
     * pagination the merchant was actually looking at, not a bare reset to
     * page 1 with every filter cleared.
     *
     * wp_nonce_field() already writes a `_wp_http_referer` hidden input with
     * the exact REQUEST_URI the form was rendered on, so this reads the four
     * filter/pagination args back out of THAT instead of asking every row
     * form to carry its own copies. A SUCCESS survives a bare reset (it bumps
     * updated_at and the default view is newest-first, so the row floats to
     * the top of page 1 regardless) — but a REFUSAL writes nothing, so
     * without this the row a merchant just acted on can end up on a page
     * that never renders it, with the refusal message going nowhere.
     */
    private function back_url(): string {
        $referer = isset($_POST['_wp_http_referer']) && is_string($_POST['_wp_http_referer'])
            ? wp_unslash($_POST['_wp_http_referer'])
            : '';

        $query = [];
        $parts = $referer !== '' ? wp_parse_url($referer) : false;
        if ($parts && !empty($parts['query'])) {
            wp_parse_str($parts['query'], $query);
        }

        $args = [];
        foreach (['paged', 's', 'sgpd_status', 'sgpd_proof'] as $key) {
            if (isset($query[$key]) && $query[$key] !== '') {
                $args[$key] = $query[$key];
            }
        }

        return add_query_arg($args, admin_url('admin.php?page=' . self::PAGE_SLUG));
    }

    public function handle_assign(): void {
        if (!current_user_can('edit_sgpd_templates')) {
            wp_die(esc_html__('You do not have permission to do that.', 'snelgraveren-product-designer'));
        }

        $id = isset($_POST['design_id']) ? (int) $_POST['design_id'] : 0;
        check_admin_referer('sgpd_assign_design_' . $id);

        $customer_input = isset($_POST['customer']) ? sanitize_text_field(wp_unslash($_POST['customer'])) : '';
        $back           = $this->back_url();

        // Taking a design back off a customer is its own button, never an empty
        // Assign: a mis-click on an empty field would otherwise remove a design
        // from a customer's account without anyone asking for it.
        if (isset($_POST['unassign'])) {
            $ok = (new DesignRepository())->assign_customer($id, 0);
            wp_safe_redirect(add_query_arg([
                'sgpd_msg' => $ok ? 'cleared' : 'failed',
                'sgpd_row' => $id,
            ], $back));
            exit;
        }

        if ($customer_input === '') {
            wp_safe_redirect(add_query_arg([
                'sgpd_msg' => 'noinput',
                'sgpd_row' => $id,
            ], $back));
            exit;
        }

        $customer_id = self::resolve_customer($customer_input);
        if ($customer_id === 0) {
            // Report the failure ON the row, with what was typed still in the
            // field. An admin notice is not enough: this site (and any site
            // running a notice-collector plugin) sweeps notices into a hidden
            // drawer, so a mistyped address would look like nothing happened.
            wp_safe_redirect(add_query_arg([
                'sgpd_msg'      => 'nouser',
                'sgpd_row'      => $id,
                'sgpd_customer' => rawurlencode($customer_input),
            ], $back));
            exit;
        }

        $ok = (new DesignRepository())->assign_customer($id, $customer_id);
        wp_safe_redirect(add_query_arg([
            'sgpd_msg' => $ok ? 'assigned' : 'failed',
            'sgpd_row' => $id,
        ], $back));
        exit;
    }

    /**
     * Send, resend or withdraw a proof.
     *
     * Recipient resolution happens BEFORE any state change. ProofReadyEmail
     * resolves its recipient from proof_email first, falling back to the
     * design's customer_id — when a design has neither (no account, no
     * address typed yet), that trigger silently sends nowhere: is_enabled()
     * && recipient short-circuits false and send() is never called. The
     * merchant would still see "Proof sent" on the row while the customer
     * never hears anything. So this handler works out the address FIRST and
     * refuses to touch ProofWorkflow at all when nothing resolves, exactly
     * like handle_assign() refuses to touch assign_customer() on an empty or
     * unresolved customer field.
     */
    public function handle_proof_action(): void {
        if (!current_user_can('edit_sgpd_templates')) {
            wp_die(esc_html__('You do not have permission to do that.', 'snelgraveren-product-designer'));
        }
        $id = isset($_POST['design_id']) ? (int) $_POST['design_id'] : 0;
        check_admin_referer('sgpd_proof_action_' . $id);

        $back = $this->back_url();

        // includes/Proof/ can ship absent from a build (a premium feature the
        // next task gates out of the free build). The proof cell already
        // hides its own form behind class_exists() before offering the
        // button, but this action is registered unconditionally and a
        // crafted POST reaches it directly — refuse cleanly instead of a
        // fatal on `new ProofWorkflow()`.
        if (!class_exists(\Snelgraveren\ProductDesigner\Proof\ProofWorkflow::class)) {
            wp_safe_redirect(add_query_arg(['sgpd_msg' => 'proof_unavailable', 'sgpd_row' => $id], $back));
            exit;
        }

        $flow = new \Snelgraveren\ProductDesigner\Proof\ProofWorkflow();
        $repo = new DesignRepository();

        if (isset($_POST['withdraw'])) {
            try {
                $flow->withdraw($id);
                $msg = 'proof_withdrawn';
            } catch (\RuntimeException $e) {
                $msg = 'proof_failed';
            }
            wp_safe_redirect(add_query_arg(['sgpd_msg' => $msg, 'sgpd_row' => $id], $back));
            exit;
        }

        // Judge the RAW value first: sanitize_email() already collapses anything
        // that would fail is_email() down to '', so checking is_email() on the
        // SANITIZED value can never tell "typo" apart from "left blank" — a
        // merchant who mistypes an address would be told to enter one, which
        // sends them looking in the wrong place. is_string() guards a crafted
        // proof_email[] POST field: wp_unslash() would happily recurse into an
        // array, but trim() on the result is a TypeError — an admin-only,
        // nonce-gated 500, but handle_assign() survives the same shape of
        // input via sanitize_text_field() and this handler should too.
        $posted_email = $_POST['proof_email'] ?? '';
        $raw          = is_string($posted_email) ? trim(wp_unslash($posted_email)) : '';

        if ($raw !== '') {
            $submitted = sanitize_email($raw);
            if ($submitted === '' || !is_email($submitted)) {
                wp_safe_redirect(add_query_arg(['sgpd_msg' => 'proof_bad_email', 'sgpd_row' => $id], $back));
                exit;
            }
            $email = $submitted;
        } else {
            $design      = $repo->get($id);
            $customer_id = $design ? (int) $design['customer_id'] : 0;
            $customer    = $customer_id > 0 ? get_user_by('id', $customer_id) : false;
            $email       = $customer ? $customer->user_email : '';
        }

        if ($email === '') {
            wp_safe_redirect(add_query_arg(['sgpd_msg' => 'proof_no_email', 'sgpd_row' => $id], $back));
            exit;
        }

        try {
            $token = $flow->send($id);
            $repo->update_proof($id, ['proof_email' => $email]);

            // The link exists either way — the state change above is
            // legitimate regardless of mail delivery, so it is never rolled
            // back here. Only the REPORTED outcome depends on whether the
            // merchant has this notification switched on in WooCommerce ->
            // Settings -> E-mails: firing the action when it's disabled is
            // harmless (ProofReadyEmail::trigger() makes its own is_enabled()
            // check and no-ops), but reporting "Proof sent" when nothing was
            // sent is exactly the false-success this task exists to close.
            $mail_enabled = class_exists(\Snelgraveren\ProductDesigner\Emails\ProofReadyEmail::class)
                ? \Snelgraveren\ProductDesigner\Emails\ProofReadyEmail::is_mail_enabled()
                : true;

            do_action('sgpd_proof_ready_notification', $repo->get($id), $token);
            $msg = $mail_enabled ? 'proof_sent' : 'proof_link_only';
        } catch (\RuntimeException $e) {
            $msg = 'proof_failed';
        }

        wp_safe_redirect(add_query_arg(['sgpd_msg' => $msg, 'sgpd_row' => $id], $back));
        exit;
    }

    /**
     * The outcome of an assign or a proof action, said next to the field
     * that caused it.
     *
     * NOT a WordPress admin notice, deliberately: notice-collector plugins
     * (this shop runs Admin Site Enhancements) sweep every .notice on the page
     * into a hidden drawer, so a mistyped e-mail address would look like
     * nothing happened at all. Next to the field it also lands where the eye
     * already is.
     *
     * The row is on screen to receive it either way, but for two different
     * reasons: a SUCCESS touches updated_at (ON UPDATE CURRENT_TIMESTAMP) and
     * the default view is newest-first unfiltered, so the row floats to the
     * top regardless of what page the merchant was on; a REFUSAL writes
     * nothing, so it relies instead on back_url() returning the merchant to
     * the exact page, filter and search they were looking at, so the row
     * that was on screen before the click is still there after it.
     */

    /**
     * Delete one design, with everything that belongs to it: its views (FK),
     * its thumbnail files and its export records and files. An ordered design
     * is refused — its hash lives in order item meta, and deleting it would
     * silently break the order screen's export buttons and thumbnail. The
     * automatic cleanup (Cleanup::run) stays far more conservative on purpose;
     * this button is the merchant explicitly deciding a design can go.
     */
    public function handle_delete(): void {
        if (!current_user_can('edit_sgpd_templates')) {
            wp_die(esc_html__('You do not have permission to do this.', 'snelgraveren-product-designer'));
        }
        $id = (int) ($_POST['design_id'] ?? 0);
        check_admin_referer('sgpd_delete_design_' . $id);

        $repo   = new \Snelgraveren\ProductDesigner\Database\DesignRepository();
        $design = $repo->get($id);
        if (!$design) {
            $this->redirect_with_message($id, 'delete_missing');
        }
        if (($design['status'] ?? '') === 'ordered') {
            $this->redirect_with_message($id, 'delete_ordered');
        }

        // File deletion is contained to the uploads directory. The stored paths
        // are server-generated (save_thumbnail_file, ExportManager), but a
        // delete routine must not TRUST that — resolve and require the real
        // path to live under uploads before anything is removed.
        $upload      = wp_upload_dir();
        $uploads_dir = realpath($upload['basedir']);
        $delete_contained = static function (string $path) use ($uploads_dir): void {
            if ($path === '' || strpos($path, '..') !== false) {
                return;
            }
            $real = realpath($path);
            if ($real && $uploads_dir && str_starts_with($real, $uploads_dir . DIRECTORY_SEPARATOR) && is_file($real)) {
                wp_delete_file($real);
            }
        };

        // Export records + files first, while the design row still exists.
        $exports = new \Snelgraveren\ProductDesigner\Database\ExportRepository();
        foreach ($exports->get_by_design($id) as $export) {
            // Multi-view formats store a comma-separated path list.
            foreach (array_filter(explode(',', (string) ($export['file_path'] ?? ''))) as $path) {
                $delete_contained($path);
            }
            $exports->delete((int) $export['id']);
        }

        // Thumbnail files (one per view).
        foreach (($design['views'] ?? []) as $view) {
            $thumb = (string) ($view['thumbnail'] ?? '');
            if ($thumb !== '' && str_starts_with($thumb, $upload['baseurl'])) {
                $delete_contained(str_replace($upload['baseurl'], $upload['basedir'], $thumb));
            }
        }

        $ok = $repo->delete($id);
        $this->redirect_with_message(0, $ok ? 'deleted' : 'delete_failed');
    }

    /** Redirect back to the list with a row-scoped message. */
    private function redirect_with_message(int $design_id, string $msg): void {
        wp_safe_redirect(add_query_arg([
            'sgpd_msg' => $msg,
            'sgpd_row' => $design_id,
        ], $this->back_url()));
        exit;
    }

    private function row_message(string $msg): string {
        switch ($msg) {
            case 'assigned':
                return __('Assigned. The customer sees it under My designs and can add it to the cart.', 'snelgraveren-product-designer');
            case 'cleared':
                return __('No longer assigned to a customer.', 'snelgraveren-product-designer');
            case 'nouser':
                return __('No account found for that ID, e-mail address or username.', 'snelgraveren-product-designer');
            case 'noinput':
                return __('Type an ID, e-mail address or username first.', 'snelgraveren-product-designer');
            case 'deleted':
                return __('Design deleted, including its thumbnails and export files.', 'snelgraveren-product-designer');
            case 'delete_ordered':
                return __('This design belongs to an order and cannot be deleted — the order screen still references it.', 'snelgraveren-product-designer');
            case 'delete_missing':
                return __('Design not found (already deleted?).', 'snelgraveren-product-designer');
            case 'delete_failed':
                return __('Deleting failed. Check the PHP error log.', 'snelgraveren-product-designer');
            case 'failed':
                return __('Could not update this design.', 'snelgraveren-product-designer');
            case 'proof_sent':
                return __('Proof sent. The customer can view and approve it from the link in their e-mail.', 'snelgraveren-product-designer');
            case 'proof_link_only':
                return __('Proof link created, but the proof e-mail is switched off in WooCommerce → Settings → E-mails, so nothing was sent. Copy the link below to hand it over yourself.', 'snelgraveren-product-designer');
            case 'proof_withdrawn':
                return __('Proof withdrawn. The link no longer works.', 'snelgraveren-product-designer');
            case 'proof_failed':
                return __('Could not send this proof.', 'snelgraveren-product-designer');
            case 'proof_no_email':
                return __('Enter an e-mail address for this proof — this design has no customer account to fall back on.', 'snelgraveren-product-designer');
            case 'proof_bad_email':
                return __('That is not a valid e-mail address.', 'snelgraveren-product-designer');
            case 'proof_unavailable':
                return __('The proof feature is not available on this install.', 'snelgraveren-product-designer');
            default:
                return '';
        }
    }

    /** Owner of a design, as something a human can read. */
    private function customer_label(array $design): string {
        $customer_id = (int) $design['customer_id'];
        if ($customer_id > 0) {
            $user = get_user_by('id', $customer_id);
            return $user
                ? sprintf('%s (%s)', $user->display_name, $user->user_email)
                : sprintf(
                    /* translators: %d: user ID of an account that no longer exists */
                    __('Deleted account (#%d)', 'snelgraveren-product-designer'),
                    $customer_id
                );
        }
        return $design['session_id'] !== ''
            ? __('Guest session', 'snelgraveren-product-designer')
            : __('Nobody', 'snelgraveren-product-designer');
    }

    public function render(): void {
        if (!current_user_can('edit_sgpd_templates')) {
            wp_die(esc_html__('You do not have permission to access this page.', 'snelgraveren-product-designer'));
        }

        // phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only filters
        $status   = sanitize_key($_GET['sgpd_status'] ?? '');
        // `sgpd_proof` here is this screen's own proof-state filter — an admin
        // GET param, unrelated to Proof\ProofPage::QUERY_VAR, which reuses the
        // same name for the customer-facing proof token. No live collision:
        // this code only runs in wp-admin, ProofPage's only on
        // `template_redirect` (never fired for admin requests). Do not "fix"
        // one into the other.
        $proof    = sanitize_key($_GET['sgpd_proof'] ?? '');
        $search   = sanitize_text_field(wp_unslash($_GET['s'] ?? ''));
        $page_num = max(1, (int) ($_GET['paged'] ?? 1));
        // Result of the last assign, reported on the row it belongs to.
        $msg      = sanitize_key($_GET['sgpd_msg'] ?? '');
        $msg_row  = (int) ($_GET['sgpd_row'] ?? 0);
        // Delete outcomes have no row left to report on — show them above the
        // table. Plain markup, deliberately NOT a .notice: the notice-collector
        // plugin on this shop sweeps those into a hidden drawer.
        $page_msg = ($msg_row === 0 && strpos($msg, 'delete') === 0 || $msg === 'deleted')
            ? $this->row_message($msg) : '';
        $typed    = sanitize_text_field(wp_unslash(rawurldecode($_GET['sgpd_customer'] ?? '')));
        // phpcs:enable

        $filters = [];
        if (in_array($status, ['draft', 'final', 'ordered', 'archived'], true)) {
            $filters['status'] = $status;
        }
        if ($search !== '') {
            $filters['search'] = $search;
        }
        $proof_states = class_exists(\Snelgraveren\ProductDesigner\Proof\ProofWorkflow::class)
            ? \Snelgraveren\ProductDesigner\Proof\ProofWorkflow::STATES
            : [];
        if (in_array($proof, $proof_states, true)) {
            $filters['proof_status'] = $proof;
        }

        $repo    = new DesignRepository();
        $total   = $repo->count_for_admin($filters);
        $designs = $repo->list_for_admin(self::PER_PAGE, $page_num, $filters);
        $statuses = [
            ''         => __('All statuses', 'snelgraveren-product-designer'),
            'draft'    => __('Draft', 'snelgraveren-product-designer'),
            'final'    => __('Final', 'snelgraveren-product-designer'),
            'ordered'  => __('Ordered', 'snelgraveren-product-designer'),
            'archived' => __('Archived', 'snelgraveren-product-designer'),
        ];
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Designs', 'snelgraveren-product-designer'); ?></h1>
            <p class="description">
                <?php esc_html_e('Design something for a customer on the product page, then assign it to their account here. They will find it under My account → My designs, and the link below reopens it for them.', 'snelgraveren-product-designer'); ?>
            </p>
            <?php if ($page_msg !== '') : ?>
                <p style="padding:8px 12px;border-left:4px solid <?php echo $msg === 'deleted' ? '#008a20' : '#d63638'; ?>;background:#fff;">
                    <?php echo esc_html($page_msg); ?>
                </p>
            <?php endif; ?>

            <form method="get" style="margin:12px 0;">
                <input type="hidden" name="page" value="<?php echo esc_attr(self::PAGE_SLUG); ?>" />
                <select name="sgpd_status">
                    <?php foreach ($statuses as $key => $label) : ?>
                        <option value="<?php echo esc_attr($key); ?>" <?php selected($status, $key); ?>><?php echo esc_html($label); ?></option>
                    <?php endforeach; ?>
                </select>
                <?php if (\Snelgraveren\ProductDesigner\Plugin::has_feature('proofs')
                    && class_exists(\Snelgraveren\ProductDesigner\Proof\ProofWorkflow::class)) : ?>
                <select name="sgpd_proof">
                    <?php
                    $proof_filters = [
                        ''                  => __('Any proof state', 'snelgraveren-product-designer'),
                        'none'              => __('Not sent', 'snelgraveren-product-designer'),
                        'sent'              => __('Waiting for customer', 'snelgraveren-product-designer'),
                        'changes_requested' => __('Change requested', 'snelgraveren-product-designer'),
                        'approved'          => __('Approved', 'snelgraveren-product-designer'),
                    ];
                    foreach ($proof_filters as $key => $label) : ?>
                        <option value="<?php echo esc_attr($key); ?>" <?php selected($proof, $key); ?>><?php echo esc_html($label); ?></option>
                    <?php endforeach; ?>
                </select>
                <?php endif; ?>
                <input type="search" name="s" value="<?php echo esc_attr($search); ?>"
                       placeholder="<?php esc_attr_e('Start of the design code', 'snelgraveren-product-designer'); ?>" />
                <?php submit_button(__('Filter', 'snelgraveren-product-designer'), 'secondary', '', false); ?>
            </form>

            <table class="wp-list-table widefat fixed striped">
                <thead>
                    <tr>
                        <th style="width:60px;"><?php esc_html_e('Preview', 'snelgraveren-product-designer'); ?></th>
                        <th><?php esc_html_e('Product', 'snelgraveren-product-designer'); ?></th>
                        <th><?php esc_html_e('Belongs to', 'snelgraveren-product-designer'); ?></th>
                        <th style="width:100px;"><?php esc_html_e('Status', 'snelgraveren-product-designer'); ?></th>
                        <th style="width:150px;"><?php esc_html_e('Last edited', 'snelgraveren-product-designer'); ?></th>
                        <th style="width:34%;"><?php esc_html_e('Assign to customer', 'snelgraveren-product-designer'); ?></th>
                        <th style="width:22%;"><?php esc_html_e('Proof', 'snelgraveren-product-designer'); ?></th>
                    </tr>
                </thead>
                <tbody>
                <?php if (!$designs) : ?>
                    <tr><td colspan="7"><?php esc_html_e('No designs found.', 'snelgraveren-product-designer'); ?></td></tr>
                <?php endif; ?>
                <?php foreach ($designs as $design) :
                    $product   = wc_get_product((int) $design['product_id']);
                    $reopen    = self::reopen_url($design);
                    $design_id = (int) $design['id'];
                    ?>
                    <tr>
                        <td>
                            <?php if (!empty($design['thumbnail'])) : ?>
                                <img src="<?php echo esc_url($design['thumbnail']); ?>" alt="" style="max-width:50px;height:auto;" />
                            <?php endif; ?>
                        </td>
                        <td>
                            <?php if ($product) : ?>
                                <a href="<?php echo esc_url(get_edit_post_link((int) $design['product_id'])); ?>"><?php echo esc_html($product->get_name()); ?></a>
                            <?php else : ?>
                                <em><?php esc_html_e('Product deleted', 'snelgraveren-product-designer'); ?></em>
                            <?php endif; ?>
                            <br /><code style="font-size:11px;"><?php echo esc_html(substr($design['design_hash'], 0, 12)); ?>…</code>
                        </td>
                        <td><?php echo esc_html($this->customer_label($design)); ?></td>
                        <td><?php echo esc_html($design['status']); ?></td>
                        <td><?php echo esc_html(mysql2date(get_option('date_format') . ' H:i', $design['updated_at'])); ?></td>
                        <td>
                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:flex;gap:6px;">
                                <input type="hidden" name="action" value="sgpd_assign_design" />
                                <input type="hidden" name="design_id" value="<?php echo esc_attr((string) $design_id); ?>" />
                                <?php wp_nonce_field('sgpd_assign_design_' . $design_id); ?>
                                <input type="text" name="customer" style="flex:1;"
                                       value="<?php echo esc_attr($msg_row === $design_id && $msg === 'nouser' ? $typed : ''); ?>"
                                       placeholder="<?php esc_attr_e('ID, e-mail or username', 'snelgraveren-product-designer'); ?>" />
                                <?php submit_button(__('Assign', 'snelgraveren-product-designer'), 'secondary', '', false); ?>
                                <?php if ((int) $design['customer_id'] > 0) : ?>
                                    <button type="submit" name="unassign" value="1" class="button-link button-link-delete">
                                        <?php esc_html_e('Unassign', 'snelgraveren-product-designer'); ?>
                                    </button>
                                <?php endif; ?>
                            </form>
                            <?php if ($msg_row === $design_id && $msg !== '' && strpos($msg, 'proof_') !== 0) : ?>
                                <p style="margin:4px 0 0;color:<?php echo in_array($msg, ['assigned', 'cleared'], true) ? '#008a20' : '#d63638'; ?>;">
                                    <?php echo esc_html($this->row_message($msg)); ?>
                                </p>
                            <?php endif; ?>
                            <?php if ($reopen !== '') : ?>
                                <input type="text" readonly value="<?php echo esc_attr($reopen); ?>"
                                       onfocus="this.select();" style="width:100%;margin-top:6px;font-size:11px;" />
                            <?php endif; ?>
                            <?php if (($design['status'] ?? '') !== 'ordered') : ?>
                                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"
                                      style="margin-top:6px;"
                                      onsubmit="return confirm('<?php echo esc_js(__('Delete this design permanently, including thumbnails and export files? This cannot be undone.', 'snelgraveren-product-designer')); ?>');">
                                    <input type="hidden" name="action" value="sgpd_delete_design" />
                                    <input type="hidden" name="design_id" value="<?php echo esc_attr((string) $design_id); ?>" />
                                    <?php wp_nonce_field('sgpd_delete_design_' . $design_id); ?>
                                    <button type="submit" class="button-link button-link-delete" style="font-size:12px;">
                                        <?php esc_html_e('Delete design', 'snelgraveren-product-designer'); ?>
                                    </button>
                                </form>
                            <?php endif; ?>
                        </td>
                        <td>
                        <?php if (\Snelgraveren\ProductDesigner\Plugin::has_feature('proofs')
                            && class_exists(\Snelgraveren\ProductDesigner\Proof\ProofWorkflow::class)) : ?>
                            <?php $proof_state = (string) ($design['proof_status'] ?? 'none'); ?>
                            <strong><?php echo esc_html(self::proof_label($proof_state)); ?></strong>
                            <?php if (!empty($design['proof_sent_at'])) : ?>
                                <br /><span class="description"><?php echo esc_html(mysql2date(get_option('date_format') . ' H:i', $design['proof_sent_at'])); ?></span>
                            <?php endif; ?>

                            <?php if ($proof_state === 'changes_requested' && !empty($design['proof_note'])) : ?>
                                <p style="margin:6px 0;padding:6px;background:#fcf9e8;border-left:3px solid #dba617;">
                                    <?php echo esc_html((string) $design['proof_note']); ?>
                                </p>
                            <?php endif; ?>

                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-top:6px;">
                                <input type="hidden" name="action" value="sgpd_proof_action" />
                                <input type="hidden" name="design_id" value="<?php echo esc_attr((string) $design_id); ?>" />
                                <?php wp_nonce_field('sgpd_proof_action_' . $design_id); ?>
                                <input type="email" name="proof_email" style="width:100%;margin-bottom:4px;"
                                       value="<?php echo esc_attr($this->proof_email_prefill($design)); ?>"
                                       placeholder="<?php esc_attr_e('E-mail address for the proof', 'snelgraveren-product-designer'); ?>" />
                                <?php submit_button(
                                    $proof_state === 'none'
                                        ? __('Send proof', 'snelgraveren-product-designer')
                                        : __('Send again', 'snelgraveren-product-designer'),
                                    'secondary', '', false
                                ); ?>
                                <?php if ($proof_state !== 'none') : ?>
                                    <button type="submit" name="withdraw" value="1" class="button-link button-link-delete">
                                        <?php esc_html_e('Withdraw', 'snelgraveren-product-designer'); ?>
                                    </button>
                                <?php endif; ?>
                            </form>
                            <?php if ($msg_row === $design_id && $msg !== '' && strpos($msg, 'proof_') === 0) :
                                // proof_link_only is a PARTIAL success — the link was created, only
                                // the e-mail didn't go out — so it gets its own amber "done, but read
                                // this" colour, not the failure red: the link WAS created, and reading
                                // it as a failure is exactly the "success looks like failure" shape an
                                // earlier fix (5739a49) already corrected for proof_sent/proof_withdrawn.
                                $row_colour = '#d63638';
                                if (in_array($msg, ['proof_sent', 'proof_withdrawn'], true)) {
                                    $row_colour = '#008a20';
                                } elseif ($msg === 'proof_link_only') {
                                    $row_colour = '#996800';
                                }
                            ?>
                                <p style="margin:4px 0 0;color:<?php echo esc_attr($row_colour); ?>;">
                                    <?php echo esc_html($this->row_message($msg)); ?>
                                </p>
                            <?php endif; ?>
                            <?php if (!empty($design['proof_token']) && class_exists(\Snelgraveren\ProductDesigner\Proof\ProofPage::class)) : ?>
                                <input type="text" readonly
                                       value="<?php echo esc_attr(\Snelgraveren\ProductDesigner\Proof\ProofPage::url((string) $design['proof_token'])); ?>"
                                       onfocus="this.select();" style="width:100%;margin-top:6px;font-size:11px;" />
                            <?php endif; ?>
                        <?php else : ?>
                            <span class="description"><?php esc_html_e('Pro feature', 'snelgraveren-product-designer'); ?></span>
                        <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>

            <?php
            $pages = (int) ceil($total / self::PER_PAGE);
            if ($pages > 1) {
                echo '<div class="tablenav"><div class="tablenav-pages">';
                echo wp_kses_post(paginate_links([
                    'base'      => add_query_arg('paged', '%#%'),
                    'format'    => '',
                    'current'   => $page_num,
                    'total'     => $pages,
                    'prev_text' => '&laquo;',
                    'next_text' => '&raquo;',
                ]));
                echo '</div></div>';
            }
            ?>
        </div>
        <?php
    }
}
