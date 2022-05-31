{ pkgs }: {
	deps = [
		pkgs.nodejs-16_x
        	pkgs.nodePackages.typescript-language-server
        	pkgs.nodePackages.yarn
        	pkgs.replitPackages.jest
		pkgs.python39Full
		pkgs.nano
	];
}
