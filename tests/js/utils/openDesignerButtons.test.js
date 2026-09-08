import { getExternalOpenButtons } from '../../../frontend/js/designer/src/utils/openDesignerButtons';

describe('getExternalOpenButtons', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns nothing when no open button exists', () => {
    document.body.innerHTML = '<form class="cart"><div id="pf-designer-root"></div></form>';
    expect(getExternalOpenButtons()).toEqual([]);
  });

  it('returns the PHP-rendered button that sits outside the React root', () => {
    document.body.innerHTML =
      '<form class="cart">'
      + '<div id="pf-designer-root"></div>'
      + '<button type="button" class="pf-open-designer button">Customize Product</button>'
      + '</form>';
    const found = getExternalOpenButtons();
    expect(found).toHaveLength(1);
    expect(found[0].textContent).toBe('Customize Product');
  });

  it('ignores the button React renders inside the root (it has its own onClick)', () => {
    document.body.innerHTML =
      '<form class="cart">'
      + '<div id="pf-designer-root"><button class="pf-open-designer">Inside</button></div>'
      + '<button class="pf-open-designer">Outside</button>'
      + '</form>';
    expect(getExternalOpenButtons().map((b) => b.textContent)).toEqual(['Outside']);
  });

  it('returns every external button, so a cloned form is wired too', () => {
    document.body.innerHTML =
      '<form class="cart"><div id="pf-designer-root"></div><button class="pf-open-designer">A</button></form>'
      + '<div class="sticky-clone"><button class="pf-open-designer">B</button></div>';
    expect(getExternalOpenButtons().map((b) => b.textContent)).toEqual(['A', 'B']);
  });
});
