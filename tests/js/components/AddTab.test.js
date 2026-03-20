import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AddTab from '../../../frontend/js/designer/src/components/tabs/AddTab.jsx';
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

describe('AddTab — rendering', () => {
    it('renders the Text button', () => {
        render(<AddTab />);
        expect(screen.getByRole('button', { name: /add text element/i })).toBeInTheDocument();
        expect(screen.getByText('Text')).toBeInTheDocument();
    });

    it('renders the Image button', () => {
        render(<AddTab />);
        expect(screen.getByRole('button', { name: /add image element/i })).toBeInTheDocument();
        expect(screen.getByText('Image')).toBeInTheDocument();
    });

    it('renders the SVG button', () => {
        render(<AddTab />);
        expect(screen.getByRole('button', { name: /add svg element/i })).toBeInTheDocument();
        expect(screen.getByText('SVG')).toBeInTheDocument();
    });
});

describe('AddTab — setActiveTool', () => {
    it('clicking Text calls setActiveTool with "add-text"', () => {
        const mockSetActiveTool = jest.fn();
        useDesignerStore.setState({ setActiveTool: mockSetActiveTool });
        render(<AddTab />);
        fireEvent.click(screen.getByText('Text'));
        expect(mockSetActiveTool).toHaveBeenCalledWith('add-text');
    });

    it('clicking Text again when already active resets tool to "select"', () => {
        const mockSetActiveTool = jest.fn();
        useDesignerStore.setState({ activeTool: 'add-text', setActiveTool: mockSetActiveTool });
        render(<AddTab />);
        fireEvent.click(screen.getByText('Text'));
        expect(mockSetActiveTool).toHaveBeenCalledWith('select');
    });

    it('active Text button has the active CSS class', () => {
        useDesignerStore.setState({ activeTool: 'add-text' });
        render(<AddTab />);
        expect(screen.getByText('Text')).toHaveClass('pf-add-tools__btn--active');
    });
});

describe('AddTab — file upload', () => {
    it('clicking Image triggers file upload with "image"', () => {
        const mockTriggerFileUpload = jest.fn();
        useDesignerStore.setState({ triggerFileUpload: mockTriggerFileUpload });
        render(<AddTab />);
        fireEvent.click(screen.getByText('Image'));
        expect(mockTriggerFileUpload).toHaveBeenCalledWith('image');
    });

    it('clicking SVG triggers file upload with "svg"', () => {
        const mockTriggerFileUpload = jest.fn();
        useDesignerStore.setState({ triggerFileUpload: mockTriggerFileUpload });
        render(<AddTab />);
        fireEvent.click(screen.getByText('SVG'));
        expect(mockTriggerFileUpload).toHaveBeenCalledWith('svg');
    });

    it('does not throw when triggerFileUpload is null', () => {
        useDesignerStore.setState({ triggerFileUpload: null });
        render(<AddTab />);
        expect(() => fireEvent.click(screen.getByText('Image'))).not.toThrow();
    });
});

describe('AddTab — zone restrictions', () => {
    it('all buttons are enabled when no zones are configured', () => {
        useDesignerStore.setState({
            template: { views: [{ zones_config: [] }] },
            currentViewIndex: 0,
        });
        render(<AddTab />);
        expect(screen.getByText('Text')).not.toBeDisabled();
        expect(screen.getByText('Image')).not.toBeDisabled();
        expect(screen.getByText('SVG')).not.toBeDisabled();
    });

    it('disables Image and SVG when only text type is allowed', () => {
        useDesignerStore.setState({
            template: {
                views: [{ zones_config: [{ allowed_types: ['text'] }] }],
            },
            currentViewIndex: 0,
        });
        render(<AddTab />);
        expect(screen.getByText('Text')).not.toBeDisabled();
        expect(screen.getByText('Image')).toBeDisabled();
        expect(screen.getByText('SVG')).toBeDisabled();
    });
});
