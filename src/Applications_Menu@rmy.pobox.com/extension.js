// Copyright (C) 2011 R M Yorston
// Licence: GPLv2+

const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const Gettext = imports.gettext.domain('gnome-shell');
const _ = Gettext.gettext;

function ApplicationMenuItem() {
    this._init.apply(this, arguments);
}

ApplicationMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(app, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        let box = new St.BoxLayout({ name: 'applicationMenuBox',
                                     style_class: 'application-menu-box'});
        this.addActor(box);

        let icon = app.create_icon_texture(24);
        box.add(icon);

        let label = new St.Label({ text: app.get_name() });
        box.add(label);

        this.app = app;

        this.connect('activate', Lang.bind(this, function() {
            let app = Shell.AppSystem.get_default().get_app(this.app.get_id());
            app.open_new_window(-1);
        }));
    }
};

function ApplicationsMenuButton(path) {
    this._init(path);
}

ApplicationsMenuButton.prototype = {
    __proto__: PanelMenu.Button.prototype,

    _init: function(path) {
        this._path = path;
        PanelMenu.Button.prototype._init.call(this, 0.0);
        let label = new St.Label({ text: _("Applications") });
        this.actor.set_child(label);

        this._buildMenu();

        Shell.AppSystem.get_default().connect('installed-changed', Lang.bind(this, this._rebuildMenu));

        let themeContext = St.ThemeContext.get_for_stage(global.stage);
        themeContext.connect('changed', Lang.bind(this, this._themeChanged));
    },

    _buildMenu: function() {
        let appSystem = Shell.AppSystem.get_default();
        let sections = appSystem.get_sections();

        for ( let i=0; i<sections.length; ++i ) {
            let submenu = new PopupMenu.PopupSubMenuMenuItem(sections[i]);
            this.menu.addMenuItem(submenu);

            let apps = appSystem.get_flattened_apps().filter(function(app) {
                           return !app.get_is_nodisplay() &&
                               sections[i] == app.get_section();
                       });

            for ( let j=0; j<apps.length; ++j ) {
                let menuItem = new ApplicationMenuItem(apps[j]);

                submenu.menu.addMenuItem(menuItem, 0);
            }
	}
    },

    _rebuildMenu: function() {
        this.menu.removeAll();
        this._buildMenu();
    },

    _themeChanged: function(themeContext) {
        let theme = themeContext.get_theme();
        let dir = Gio.file_new_for_path(this._path);
        let stylesheetFile = dir.get_child('stylesheet.css');
        if (stylesheetFile.query_exists(null)) {
            try {
                theme.load_stylesheet(stylesheetFile.get_path());
            } catch (e) {
                global.logError(baseErrorString + 'Stylesheet parse error: ' + e);
                return;
            }
        }
    },
};

function main(extensionMeta) {
    let children = Main.panel._leftBox.get_children();
    Main.panel._leftBox.remove_actor(children[0]);

    let button = new ApplicationsMenuButton(extensionMeta.path);

    Main.panel._leftBox.insert_actor(button.actor, 0);
    Main.panel._menus.addMenu(button.menu);

    // Synchronize the button's pseudo classes with its corner
    button.actor.connect('style-changed', Lang.bind(this,
        function(actor) {
            let rtl = actor.get_direction() == St.TextDirection.RTL;
            let corner = rtl ? Main.panel._rightCorner : Main.panel._leftCorner;
            let pseudoClass = actor.get_style_pseudo_class();
            corner.actor.set_style_pseudo_class(pseudoClass);
        }));
}
