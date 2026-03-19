import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '../../../frontend/js/designer/src/components/Sidebar.jsx';
import useDesignerStore from '../../../frontend/js/designer/src/store/useDesignerStore.js';

// Stub child tab components so Sidebar tests focus on tab navigation only
jest.mock('../../../frontend/js/designer/src/components/tabs/AddTab.jsx', () => ({
    __esModule: true,
    default: () => <div data-testid="add-tab-panel" />,
}));
jest.mock('../../../frontend/js/designer/src/components/tabs/ElementTab.jsx', () => ({
    __esModule: true,
    default: () => <div data-testid="element-tab-panel" />,
}));
jest.mock('../../../frontend/js/designer/src/components/tabs/ViewsTab.jsx', () => ({
    __esModule: true,
    default: () => <div data-testid="views-tab-panel" />,
}));

function resetStore() {
    useDesignerStore.setState({
        template: null,
        currentViewIndex: 0,
        designHash: null,
        isSaving: false,
        isDirty: false,
        canvasSnapshots: {},
        activeTool: 'select',
        selectedObject: null,
        error: null,
        triggerFileUpload: null,
        fabricCanvasRef: null,
    });
}

beforeEach(() => {
    resetStore();
});

describe('Sidebar — tab buttons', () => {
    it('renders all three tab buttons', () => {
        render(<Sidebar />);
        expect(screen.getByRole('tab', { name: 'Add' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Element' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Views' })).toBeInTheDocument();
    });

    it('shows the Add tab panel by default', () => {
        render(<Sidebar />);
        expect(screen.getByTestId('add-tab-panel')).toBeInTheDocument();
    });

    it('Add tab has aria-selected=true by default', () => {
        render(<Sidebar />);
        expect(screen.getByRole('tab', { name: 'Add' })).toHaveAttribute('aria-selected', 'true');
    });
});

describe('Sidebar — tab switching', () => {
    it('clicking Views tab shows Views panel', () => {
        render(<Sidebar />);
        fireEvent.click(screen.getByRole('tab', { name: 'Views' }));
        expect(screen.getByTestId('views-tab-panel')).toBeInTheDocument();
    });

    it('clicking Views tab sets Views tab as active (aria-selected)', () => {
        render(<Sidebar />);
        fireEvent.click(screen.getByRole('tab', { name: 'Views' }));
        expect(screen.getByRole('tab', { name: 'Views' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Add' })).toHaveAttribute('aria-selected', 'false');
    });

    it('clicking Views tab gives it the active CSS class', () => {
        render(<Sidebar />);
        fireEvent.click(screen.getByRole('tab', { name: 'Views' }));
        expect(screen.getByRole('tab', { name: 'Views' })).toHaveClass('pd-sidebar__tab--active');
    });
});

describe('Sidebar — Element tab disabled state', () => {
    it('Element tab is disabled when no object is selected', () => {
        render(<Sidebar />);
        expect(screen.getByRole('tab', { name: 'Element' })).toBeDisabled();
    });

    it('Element tab is enabled when an object is selected', () => {
        useDesignerStore.setState({ selectedObject: { type: 'i-text', text: 'Hello' } });
        render(<Sidebar />);
        expect(screen.getByRole('tab', { name: 'Element' })).not.toBeDisabled();
    });

    it('auto-switches to Element tab when an object becomes selected', () => {
        render(<Sidebar />);
        useDesignerStore.setState({ selectedObject: { type: 'i-text', text: 'Hello' } });
        // Re-render to trigger the useEffect
        render(<Sidebar />);
        expect(screen.getAllByRole('tab', { name: 'Element' })[0]).toHaveAttribute('aria-selected', 'true');
    });
});
