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

    public function handle_assign(): void {
        if (!current_user_can('edit_sgpd_templates')) {
            wp_die(esc_html__('You do not have permission to do that.', 'snelgraveren-product-designer'));
        }

        $id = isset($_POST['design_id']) ? (int) $_POST['design_id'] : 0;
        check_admin_referer('sgpd_assign_design_' . $id);

        $customer_input = isset($_POST['customer']) ? sanitize_text_field(wp_unslash($_POST['customer'])) : '';
        $back           = admin_url('admin.php?page=' . self::PAGE_SLUG);

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
     * The outcome of an assign, said next to the field that caused it.
     *
     * NOT a WordPress admin notice, deliberately: notice-collector plugins
     * (this shop runs Admin Site Enhancements) sweep every .notice on the page
     * into a hidden drawer, so a mistyped e-mail address would look like
     * nothing happened at all. Next to the field it also lands where the eye
     * already is.
     *
     * The row is always on screen to receive it: assigning touches updated_at
     * (ON UPDATE CURRENT_TIMESTAMP) and the default view is newest-first
     * unfiltered, so the design the merchant just acted on sits at the top.
     */
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
            case 'failed':
                return __('Could not update this design.', 'snelgraveren-product-designer');
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
        $search   = sanitize_text_field(wp_unslash($_GET['s'] ?? ''));
        $page_num = max(1, (int) ($_GET['paged'] ?? 1));
        // Result of the last assign, reported on the row it belongs to.
        $msg      = sanitize_key($_GET['sgpd_msg'] ?? '');
        $msg_row  = (int) ($_GET['sgpd_row'] ?? 0);
        $typed    = sanitize_text_field(wp_unslash(rawurldecode($_GET['sgpd_customer'] ?? '')));
        // phpcs:enable

        $filters = [];
        if (in_array($status, ['draft', 'final', 'ordered', 'archived'], true)) {
            $filters['status'] = $status;
        }
        if ($search !== '') {
            $filters['search'] = $search;
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

            <form method="get" style="margin:12px 0;">
                <input type="hidden" name="page" value="<?php echo esc_attr(self::PAGE_SLUG); ?>" />
                <select name="sgpd_status">
                    <?php foreach ($statuses as $key => $label) : ?>
                        <option value="<?php echo esc_attr($key); ?>" <?php selected($status, $key); ?>><?php echo esc_html($label); ?></option>
                    <?php endforeach; ?>
                </select>
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
                    </tr>
                </thead>
                <tbody>
                <?php if (!$designs) : ?>
                    <tr><td colspan="6"><?php esc_html_e('No designs found.', 'snelgraveren-product-designer'); ?></td></tr>
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
                            <?php if ($msg_row === $design_id && $msg !== '') : ?>
                                <p style="margin:4px 0 0;color:<?php echo $msg === 'assigned' || $msg === 'cleared' ? '#008a20' : '#d63638'; ?>;">
                                    <?php echo esc_html($this->row_message($msg)); ?>
                                </p>
                            <?php endif; ?>
                            <?php if ($reopen !== '') : ?>
                                <input type="text" readonly value="<?php echo esc_attr($reopen); ?>"
                                       onfocus="this.select();" style="width:100%;margin-top:6px;font-size:11px;" />
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
