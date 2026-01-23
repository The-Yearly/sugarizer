const TypingEffect = {
	props: ["usersTyping"],
	template: `
		<div class="loader-container">
			<div class="dots" v-if="keys.length > 0">
			  <span class="dot"></span>
			  <span class="dot"></span>
			  <span class="dot"></span>
			</div>
			<div>
				<div v-if="keys.length === 1">
					<strong>{{ usersTyping[keys[0]].name }}</strong> {{ l10n.stringIs }} {{ l10n.stringTyping }}
				</div>
				<div v-else-if="keys.length === 2">
					<strong>{{ usersTyping[keys[0]].name }}</strong> {{ l10n.stringAnd }} <strong>{{ usersTyping[keys[1]].name }}</strong> {{ l10n.stringAre }} {{ l10n.stringTyping }}
				</div>
				<div v-else-if="keys.length > 2">
					<span v-for="(key, index) in keys.slice(0, -1)" :key="key">
						<strong>{{ usersTyping[key].name }}</strong><span v-if="index < keys.length - 2">, </span>
					</span>
					<span> {{ l10n.stringAnd }} <strong>{{ usersTyping[keys[keys.length - 1]].name }}</strong> {{ l10n.stringAre }} {{ l10n.stringTyping }}</span>
				</div>
			</div>
		</div>
	`,
	data() {
		return {
			l10n: {
				stringIs: "",
				stringAnd: "",
				stringAre: "",
				stringTyping: "",
			},
		};
	},
	created() {
		var vm = this;
		window.addEventListener(
			"localized",
			(e) => {
				e.detail.l10n.localize(vm.l10n);
			},
			{ once: true },
		);
	},
	computed: {
		keys() {
			return Object.keys(this.usersTyping);
		},
	},
	methods: {},
};
