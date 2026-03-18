<?php
namespace ProductDesigner\Admin;

defined('ABSPATH') || exit;

use ProductDesigner\Database\TemplateRepository;

if (!class_exists('WP_List_Table')) {
    require_once ABSPATH . 'wp-admin/includes/class-wp-list-table.php';
}

class TemplateListTable extends \WP_List_Table {

    private TemplateRepository $repo;

    public function __construct() {
        parent::__construct([
            'singular' => 'template',
            'plural'   => 'templates',
            'ajax'     => false,
        ]);
        $this->repo = new TemplateRepository();
    }

    public function get_columns(): array {
        return [
            'cb'           => '<input type="checkbox">',
            'title'        => __('Title', 'product-designer'),
            'status'       => __('Status', 'product-designer'),
            'view_count'   => __('Views', 'product-designer'),
            'product_count'=> __('Products', 'product-designer'),
            'created_at'   => __('Created', 'product-designer'),
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
        return [
            'publish' => __('Publish', 'product-designer'),
            'archive' => __('Archive', 'product-designer'),
            'delete'  => __('Delete', 'product-designer'),
        ];
    }

    public function prepare_items(): void {
        // Must process bulk actions BEFORE reading items.
        $this->process_bulk_action();

        $per_page = 20;
        $page     = $this->get_pagenum();
        $status   = sanitize_text_field($_GET['pd_status'] ?? '');

        $this->items = $this->repo->list($per_page, $page, $status);
        foreach ($this->items as &$item) {
            $item['view_count']    = $this->repo->count_views((int) $item['id']);
            $item['product_count'] = $this->repo->count_products((int) $item['id']);
        }
        unset($item);

        $total = $this->repo->count($status);
        $this->set_pagination_args([
            'total_items' => $total,
            'per_page'    => $per_page,
            'total_pages' => (int) ceil($total / $per_page),
        ]);

        $this->_column_headers = [$this->get_columns(), [], $this->get_sortable_columns()];
    }

    protected function process_bulk_action(): void {
        $action = $this->current_action();
        if (!$action || empty($_POST['template'])) return;

        check_admin_referer('bulk-templates');

        $ids = array_map('intval', (array) $_POST['template']);

        foreach ($ids as $id) {
            if ($action === 'delete') {
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
        $edit_url   = admin_url('admin.php?page=pd-template-builder&template_id=' . absint($item['id']));
        $delete_url = wp_nonce_url(
            admin_url('admin.php?page=product-designer&action=delete&template=' . absint($item['id'])),
            'delete-template_' . absint($item['id'])
        );
        $title = '<strong><a href="' . esc_url($edit_url) . '">' . esc_html($item['title']) . '</a></strong>';

        $actions = [
            'edit'   => '<a href="' . esc_url($edit_url) . '">' . __('Edit', 'product-designer') . '</a>',
            'delete' => '<a href="' . esc_url($delete_url) . '" onclick="return confirm(\'Delete this template?\')">'
                        . __('Delete', 'product-designer') . '</a>',
        ];
        return $title . $this->row_actions($actions);
    }

    protected function column_status(array $item): string {
        $labels = ['draft' => __('Draft', 'product-designer'), 'published' => __('Published', 'product-designer'), 'archived' => __('Archived', 'product-designer')];
        return esc_html($labels[$item['status']] ?? $item['status']);
    }

    protected function column_view_count(array $item): string {
        return (string) (int) $item['view_count'];
    }

    protected function column_product_count(array $item): string {
        return (string) (int) $item['product_count'];
    }

    protected function column_created_at(array $item): string {
        return esc_html(wp_date(get_option('date_format'), strtotime($item['created_at'])));
    }

    /**
     * Render status tabs (All | Draft | Published | Archived).
     */
    public function render_status_tabs(): void {
        $counts      = $this->repo->get_status_counts();
        $total       = array_sum($counts);
        $current     = sanitize_text_field($_GET['pd_status'] ?? '');
        $base_url    = admin_url('admin.php?page=product-designer');

        $tabs = [
            ''          => __('All', 'product-designer') . " ({$total})",
            'draft'     => __('Draft', 'product-designer') . " ({$counts['draft']})",
            'published' => __('Published', 'product-designer') . " ({$counts['published']})",
            'archived'  => __('Archived', 'product-designer') . " ({$counts['archived']})",
        ];

        echo '<ul class="subsubsub">';
        $links = [];
        foreach ($tabs as $status => $label) {
            $url     = $status !== '' ? add_query_arg('pd_status', $status, $base_url) : $base_url;
            $class   = $current === $status ? ' class="current"' : '';
            $links[] = '<li><a href="' . esc_url($url) . '"' . $class . '>' . esc_html($label) . '</a>';
        }
        echo implode(' | ', $links);
        echo '</ul>';
    }
}
