import { createModel } from "/js/model.js";
import { UltronView } from "/js/view.js";
import { UltronPresenter } from "/js/presenter.js";

const model = createModel();
const view = new UltronView();
const presenter = new UltronPresenter(model, view);

presenter.start();

