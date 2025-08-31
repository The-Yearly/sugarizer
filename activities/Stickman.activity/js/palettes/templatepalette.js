define([
	"sugar-web/graphics/palette",
	"text!activity/palettes/templatepalette.html"
], function (palette, template) {
	var templatepalette = {};

	templatepalette.TemplatePalette = function (invoker, primaryText) {
		palette.Palette.call(this, invoker, primaryText);
		this.getPalette().id = "template-palette";
		var containerElem = document.createElement("div");
		containerElem.innerHTML = template;
		this.setContent([containerElem]);

		// event listeners for template buttons
		var self = this;
		setTimeout(function () {
			var runButton = self.getPalette().querySelector("#run-button");
			var boxingButton = self.getPalette().querySelector("#boxing-button");
			var dance1Button = self.getPalette().querySelector("#dance1-button");
			var dance2Button = self.getPalette().querySelector("#dance2-button");

			function setActiveButton(activeButton) {
				[runButton, boxingButton, dance1Button, dance2Button].forEach(button => {
					if (button) button.classList.remove('active');
				});
				if (activeButton) activeButton.classList.add('active');
			}

			if (runButton) {
				runButton.addEventListener("click", function () {
					document.dispatchEvent(new CustomEvent('template-selected', {
						detail: { template: 'run' }
					}));
					setActiveButton(runButton);
					self.popDown();
				});
			}

			if (boxingButton) {
				boxingButton.addEventListener("click", function () {
					document.dispatchEvent(new CustomEvent('template-selected', {
						detail: { template: 'boxing' }
					}));
					setActiveButton(boxingButton);
					self.popDown();
				});
			}

			if (dance1Button) {
				dance1Button.addEventListener("click", function () {
					document.dispatchEvent(new CustomEvent('template-selected', {
						detail: { template: 'dance1' }
					}));
					setActiveButton(dance1Button);
					self.popDown();
				});
			}

			if (dance2Button) {
				dance2Button.addEventListener("click", function () {
					document.dispatchEvent(new CustomEvent('template-selected', {
						detail: { template: 'dance2' }
					}));
					setActiveButton(dance2Button);
					self.popDown();
				});
			}
		}, 100);
	};

	var addEventListener = function (type, listener, useCapture) {
		return this.getPalette().addEventListener(type, listener, useCapture);
	};

	templatepalette.TemplatePalette.prototype = Object.create(
		palette.Palette.prototype,
		{
			addEventListener: {
				value: addEventListener,
				enumerable: true,
				configurable: true,
				writable: true,
			},
		}
	);

	return templatepalette;
});