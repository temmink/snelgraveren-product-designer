<?php
namespace ProductForge\Admin;

defined('ABSPATH') || exit;

use ProductForge\Database\TemplateRepository;

if (!class_exists('WP_List_Table')) {
    require_once ABSPATH . 'wp-admin/includes/class-wp-list-table.php';
}

class TemplateListTable extends \WP_List_Table {

    private TemplateRepository $repo;
    private array $view_counts    = [];
    private array $product_counts = [];

    public function __construct() {
        parent::__construct([
            'singular' => 'template',
            'plural'   => 'templates',
            'ajax'     => false,
        ]);
        $this->repo = new TemplateRepository();
    }

    private function is_trash_view(): bool {
        return ($this->get_current_status() === 'trashed');
    }

    private function get_current_status(): string {
        return sanitize_text_field($_GET['pf_status'] ?? '');
    }

    public function get_columns(): array {
        return [
            'cb'           => '<input type="checkbox">',
            'title'        => __('Title', 'productforge'),
            'status'       => __('Status', 'productforge'),
            'view_count'   => __('Views', 'productforge'),
            'product_count'=> __('Products', 'productforge'),
            'created_at'   => __('Created', 'productforge'),
        ];
    }

    protected function get_sortable_columns(): array {
        return [
            'title'      => ['title', false],
            'status'     => ['status', false],
            'created_at' => ['created_at', true],
        ];
    }

    protected function get_bulk_actions(): array {
        if ($this->is_trash_view()) {
            return [
                'restore'          => __('Restore', 'productforge'),
                'delete_permanent' => __('Delete Permanently', 'productforge'),
            ];
        }
        return [
            'publish' => __('Publish', 'productforge'),
            'archive' => __('Archive', 'productforge'),
            'trash'   => __('Move to Trash', 'productforge'),
        ];
    }

    public function prepare_items(): void {
        $this->process_bulk_action();
        $this->process_row_action();

        $per_page = 20;
        $page     = $this->get_pagenum();
        $status   = $this->get_current_status();

        $this->items = $this->repo->list($per_page, $page, $status);

        $ids                   = array_map(function ($item) { return (int) $item['id']; }, $this->items);
        $this->view_counts     = $this->repo->count_views_batch($ids);
        $this->product_counts  = $this->repo->count_products_batch($ids);

        $total = $this->repo->count($status);
        $this->set_pagination_args([
            'total_items' => $total,
            'per_page'    => $per_page,
            'total_pages' => (int) ceil($total / $per_page),
        ]);

        $this->_column_headers = [$this->get_columns(), [], $this->get_sortable_columns()];
    }

    /**
     * Handle single-row actions (GET links from row_actions).
     */
    private function process_row_action(): void {
        $action = sanitize_text_field($_GET['action'] ?? '');
        $id     = (int) ($_GET['template'] ?? 0);
        if (!$action || !$id) return;

        if ($action === 'trash') {
            check_admin_referer('trash-template_' . $id);
            $this->repo->trash($id);
            wp_safe_redirect(admin_url('admin.php?page=productforge&trashed=1'));
            exit;
        }

        if ($action === 'restore') {
            check_admin_referer('restore-template_' . $id);
            $this->repo->restore($id);
            wp_safe_redirect(admin_url('admin.php?page=productforge&restored=1'));
            exit;
        }

        if ($action === 'delete_permanent') {
            check_admin_referer('delete-template_' . $id);
            $this->repo->delete($id);
            wp_safe_redirect(admin_url('admin.php?page=productforge&pf_status=trashed&deleted=1'));
            exit;
        }
    }

    protected function process_bulk_action(): void {
        $action = $this->current_action();
        if (!$action || empty($_POST['template'])) return;

        check_admin_referer('bulk-templates');

        $ids = array_map('intval', (array) $_POST['template']);

        foreach ($ids as $id) {
            if ($action === 'trash') {
                $this->repo->trash($id);
            } elseif ($action === 'restore') {
                $this->repo->restore($id);
            } elseif ($action === 'delete_permanent') {
                $this->repo->delete($id);
            } elseif (in_array($action, ['publish', 'archive'], true)) {
                $this->repo->update($id, ['status' => $action === 'publish' ? 'published' : 'archived']);
            }
        }
    }

    protected function column_default($item, $column_name): string {
        return esc_html($item[$column_name] ?? '');
    }

    protected function column_cb($item): string {
        return '<input type="checkbox" name="template[]" value="' . absint($item['id']) . '">';
    }

    protected function column_title(array $item): string {
        $id = absint($item['id']);

        if ($this->is_trash_view()) {
            $title = '<strong>' . esc_html($item['title']) . '</strong>';

            $restore_url = wp_nonce_url(
                admin_url('admin.php?page=productforge&action=restore&template=' . $id),
                'restore-template_' . $id
            );
            $delete_url = wp_nonce_url(
                admin_url('admin.php?page=productforge&action=delete_permanent&template=' . $id),
                'delete-template_' . $id
            );

            $actions = [
                'restore' => '<a href="' . esc_url($restore_url) . '">' . __('Restore', 'productforge') . '</a>',
                'delete'  => '<a href="' . esc_url($delete_url) . '" onclick="return confirm(\'Delete this template permanently?\')">'
                             . __('Delete Permanently', 'productforge') . '</a>',
            ];
        } else {
            $edit_url  = admin_url('admin.php?page=pf-template-builder&template_id=' . $id);
            $trash_url = wp_nonce_url(
                admin_url('admin.php?page=productforge&action=trash&template=' . $id),
                'trash-template_' . $id
            );

            $title = '<strong><a href="' . esc_url($edit_url) . '">' . esc_html($item['title']) . '</a></strong>';

            $actions = [
                'edit'  => '<a href="' . esc_url($edit_url) . '">' . __('Edit', 'productforge') . '</a>',
                'trash' => '<a href="' . esc_url($trash_url) . '">' . __('Trash', 'productforge') . '</a>',
            ];
        }

        return $title . $this->row_actions($actions);
    }

    protected function column_status(array $item): string {
        $labels = [
            'draft'     => __('Draft', 'productforge'),
            'published' => __('Published', 'productforge'),
            'archived'  => __('Archived', 'productforge'),
            'trashed'   => __('Trashed', 'productforge'),
        ];
        return esc_html($labels[$item['status']] ?? $item['status']);
    }

    protected function column_view_count(array $item): string {
        return (string) ($this->view_counts[(int) $item['id']] ?? 0);
    }

    protected function column_product_count(array $item): string {
        return (string) ($this->product_counts[(int) $item['id']] ?? 0);
    }

    protected function column_created_at(array $item): string {
        return esc_html(wp_date(get_option('date_format'), strtotime($item['created_at'])));
    }

    /**
     * Render status tabs (All | Draft | Published | Archived | Trash).
     */
    public function render_status_tabs(): void {
        $counts      = $this->repo->get_status_counts();
        $total       = $counts['draft'] + $counts['published'] + $counts['archived'];
        $current     = $this->get_current_status();
        $base_url    = admin_url('admin.php?page=productforge');

        $tabs = [
            ''          => __('All', 'productforge') . " ({$total})",
            'draft'     => __('Draft', 'productforge') . " ({$counts['draft']})",
            'published' => __('Published', 'productforge') . " ({$counts['published']})",
            'archived'  => __('Archived', 'productforge') . " ({$counts['archived']})",
        ];

        // Only show Trash tab if there are trashed items.
        if ($counts['trashed'] > 0) {
            $tabs['trashed'] = __('Trash', 'productforge') . " ({$counts['trashed']})";
        }

        echo '<ul class="subsubsub">';
        $links = [];
        foreach ($tabs as $status => $label) {
            $url     = $status !== '' ? add_query_arg('pf_status', $status, $base_url) : $base_url;
            $class   = $current === $status ? ' class="current"' : '';
            $links[] = '<li><a href="' . esc_url($url) . '"' . $class . '>' . esc_html($label) . '</a>';
        }
        echo implode(' | ', $links);
        echo '</ul>';
    }
}
