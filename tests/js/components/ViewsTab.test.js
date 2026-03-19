import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ViewsTab from '../../../frontend/js/designer/src/components/tabs/ViewsTab.jsx';
import useDesignerStore from '../../../frontend/js/designer/src/store/useDesignerStore.js';

function resetStore(overrides = {}) {
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
        ...overrides,
    });
}

beforeEach(() => {
    resetStore();
});

describe('ViewsTab — rendering', () => {
    it('renders no buttons when template has no views', () => {
        render(<ViewsTab />);
        expect(screen.queryAllByRole('tab')).toHaveLength(0);
    });

    it('renders one button per view', () => {
        useDesignerStore.setState({
            template: {
                views: [
                    { id: 1, name: 'Front' },
                    { id: 2, name: 'Back' },
                    { id: 3, name: 'Sleeve' },
                ],
            },
        });
        render(<ViewsTab />);
        expect(screen.getAllByRole('tab')).toHaveLength(3);
    });

    it('displays view names from the template data', () => {
        useDesignerStore.setState({
            template: {
                views: [
                    { id: 1, name: 'Front' },
                    { id: 2, name: 'Back' },
                ],
            },
        });
        render(<ViewsTab />);
        expect(screen.getByText('Front')).toBeInTheDocument();
        expect(screen.getByText('Back')).toBeInTheDocument();
    });

    it('falls back to "View N" when view has no name', () => {
        useDesignerStore.setState({
            template: {
                views: [{ id: 1 }, { id: 2 }],
            },
        });
        render(<ViewsTab />);
        expect(screen.getByText('View 1')).toBeInTheDocument();
        expect(screen.getByText('View 2')).toBeInTheDocument();
    });
});

describe('ViewsTab — active tab', () => {
    it('first tab has active class when currentViewIndex is 0', () => {
        useDesignerStore.setState({
            template: { views: [{ id: 1, name: 'Front' }, { id: 2, name: 'Back' }] },
            currentViewIndex: 0,
        });
        render(<ViewsTab />);
        expect(screen.getByText('Front')).toHaveClass('pd-views__btn--active');
        expect(screen.getByText('Back')).not.toHaveClass('pd-views__btn--active');
    });

    it('second tab has active class when currentViewIndex is 1', () => {
        useDesignerStore.setState({
            template: { views: [{ id: 1, name: 'Front' }, { id: 2, name: 'Back' }] },
            currentViewIndex: 1,
        });
        render(<ViewsTab />);
        expect(screen.getByText('Back')).toHaveClass('pd-views__btn--active');
        expect(screen.getByText('Front')).not.toHaveClass('pd-views__btn--active');
    });

    it('active tab has aria-selected=true', () => {
        useDesignerStore.setState({
            template: { views: [{ id: 1, name: 'Front' }, { id: 2, name: 'Back' }] },
            currentViewIndex: 0,
        });
        render(<ViewsTab />);
        expect(screen.getByText('Front')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('Back')).toHaveAttribute('aria-selected', 'false');
    });
});

describe('ViewsTab — switching views', () => {
    it('clicking a tab calls setCurrentViewIndex with its index', () => {
        const mockSetCurrentViewIndex = jest.fn();
        useDesignerStore.setState({
            template: { views: [{ id: 1, name: 'Front' }, { id: 2, name: 'Back' }] },
            currentViewIndex: 0,
            setCurrentViewIndex: mockSetCurrentViewIndex,
        });
        render(<ViewsTab />);
        fireEvent.click(screen.getByText('Back'));
        expect(mockSetCurrentViewIndex).toHaveBeenCalledWith(1);
    });

    it('clicking the already-active tab does not call setCurrentViewIndex', () => {
        const mockSetCurrentViewIndex = jest.fn();
        useDesignerStore.setState({
            template: { views: [{ id: 1, name: 'Front' }, { id: 2, name: 'Back' }] },
            currentViewIndex: 0,
            setCurrentViewIndex: mockSetCurrentViewIndex,
        });
        render(<ViewsTab />);
        fireEvent.click(screen.getByText('Front'));
        expect(mockSetCurrentViewIndex).not.toHaveBeenCalled();
    });
});
