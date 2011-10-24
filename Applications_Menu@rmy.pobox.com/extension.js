
const DBus = imports.dbus;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GMenu = imports.gi.GMenu;

const GnomeSession = imports.misc.gnomeSession;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const EndSessionDialog = imports.ui.endSessionDialog;

const Gettext = imports.gettext;
const _ = Gettext.domain('gnome-shell').gettext;

const BUS_NAME = 'org.gnome.ScreenSaver';
const OBJECT_PATH = '/org/gnome/ScreenSaver';

const LOCKDOWN_SCHEMA = 'org.gnome.desktop.lockdown';
const DISABLE_USER_SWITCH_KEY = 'disable-user-switching';
const DISABLE_LOCK_SCREEN_KEY = 'disable-lock-screen';
const DISABLE_LOG_OUT_KEY = 'disable-log-out';

const ScreenSaverInterface = {
    name: BUS_NAME,
    methods: [ { name: 'Lock', inSignature: '' } ]
};

let _f = null;
let lastOpened = null;
let userMenu = null;

/**
 * AppSystem wrapper.
 * Note the Shell.AppSystem API has been changed since GnomeShell 3.1.90.1
 */
function AppSystemWrapper() {
    this._init.apply(this, arguments);
}

AppSystemWrapper.prototype = {
    _init: function() {
        this._appSystem = Shell.AppSystem.get_default();
    },
    connect: function(event, callback) {
        return this._appSystem.connect(event, callback);
    },
    get_tree: function() {
        return this._appSystem.get_tree();
    },
    lookup_app_by_tree_entry: function(entry) {
        return this._appSystem.lookup_app_by_tree_entry(entry);
    },
    lookup_app: function(appId) {
        return this._appSystem.lookup_app(appId);
    },
    get_all: function() {
        return this._appSystem.get_all();
    }
};

var AppSystem = (function() {
    var instance = null;
    return {
        get_default: function() {
            if (instance == null)
                instance = new AppSystemWrapper();
            return instance;
        }
    };
})();

/**
 * AppInfo wrapper.
 * Note the Shell.AppInfo API has been changed since GnomeShell 3.1.90.1
 */
function AppInfoWrapper(app) {
    this._init.apply(this, arguments);
}

AppInfoWrapper.prototype = {
    _init: function(app) {
        this._app = app;
    },
    get_id: function() {
        return this._app.get_id();
    },
    get_name: function() {
        return this._app.get_name();
    },
    open_new_window: function(param) {
        return this._app.open_new_window(param);
    },
    get_section: function() {
        //return this._app.get_section();
    },
    get_nodisplay: function() {
        return this._app.get_nodisplay();
    },
    create_icon_texture: function(size) {
        return this._app.create_icon_texture(size);
    }
};


/**
 * Retrieve the installed applications by categories.
 * @param boolean showAll Retrieve all applications or those without the
 *                        "nodisplay" flag.
 */
function AppViewByCategories(showAll) {
    this._init.apply(this, arguments);
}

AppViewByCategories.prototype = {
    _init: function(showAll) {
        this._showAll = typeof(showAll) == 'boolean' ? showAll : false;
        this._categories = [];
        this._applications = {};
        this._appSystem = AppSystem.get_default();
        this._load_categories();
    },

    get_categories: function() {
        return this._categories;
    },

    get_applications: function(category) {
        return this._applications[category];
    },

    _load_categories: function() {

        var tree = this._appSystem.get_tree();
        var root = tree.get_root_directory();

        var iter = root.iter();
        var nextType;

        while ((nextType = iter.next()) != GMenu.TreeItemType.INVALID) {
            if (nextType == GMenu.TreeItemType.DIRECTORY) {
                var appList = [];
                var dir = iter.get_directory();
                this._load_applications(dir, appList);

                this._categories.push(dir.get_name());
                this._applications[dir.get_name()] = appList;
            }
        }
    },

    _load_applications: function(category, appList) {

        var iter = category.iter();
        var nextType;

        while ((nextType = iter.next()) != GMenu.TreeItemType.INVALID) {
            if (nextType == GMenu.TreeItemType.ENTRY) {
                var entry = iter.get_entry();
                var app = this._appSystem.lookup_app_by_tree_entry(entry);
                app = new AppInfoWrapper(app);
                if (this._showAll == true || !entry.get_app_info().get_nodisplay())
                //if (this._showAll == true || !app.get_nodisplay())
                    appList.push(app);
            } else if (nextType == GMenu.TreeItemType.DIRECTORY) {
                this._load_applications(iter.get_directory());
            }
        }
    }
};


/**
 * A menu item that represents an application.
 * @param AppInfo app An AppInfo object.
 */
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
            let app = AppSystem.get_default().lookup_app(this.app.get_id());
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
        let label = new St.Label({ text: _f("Menu") });
        this.actor.add_actor(label);

        this._buildMenu();

        AppSystem.get_default().connect('installed-changed', Lang.bind(this, this._rebuildMenu));

        let themeContext = St.ThemeContext.get_for_stage(global.stage);
        themeContext.connect('changed', Lang.bind(this, this._themeChanged));
    },

    _buildMenu: function() {

        var v = new AppViewByCategories(false);
        var categories = v.get_categories();

        for (var i=0, cl=categories.length; i<cl; i++) {

            var category = categories[i];
            var apps = v.get_applications(category);

            var submenu = new PopupMenu.PopupSubMenuMenuItem(category);
            this.menu.addMenuItem(submenu);

            for (var j=0, al=apps.length; j<al; j++) {

                var app = apps[j];
                var menuItem = new ApplicationMenuItem(app);
                submenu.menu.addMenuItem(menuItem, 0);
            }
        }

        createSessionItems(this.menu);
    },

    _rebuildMenu: function() {
        this.menu.removeAll();
        this._buildMenu();
    },

    _themeChanged: function(themeContext) {
        let theme = themeContext.get_theme();
        let dir = Gio.file_new_for_path(this._path);
        let stylesheetFile = dir.get_child('stylesheet.css');
        if (stylesheetFile.query_exists(null))
            theme.load_stylesheet(stylesheetFile.get_path());
    }
};

/**
 * Return the user menu object.
 */
function getUserMenu() {

    if (userMenu !== null)
        return userMenu;

    let indicator = Main.panel._statusArea['userMenu'];
    let children = Main.panel._rightBox.get_children();

    for (let i = children.length - 1; i >= 0; i--) {
        if (indicator.actor === children[i]) {
            userMenu = indicator;
            break;
        }
    }

    return userMenu;
}

/**
 * Returns the activities button.
 */
function getActivitiesButton() {
    return Main.panel._activitiesButton;
}

/**
 * Add session options to the applications menu.
 */
function createSessionItems(menu) {

    updateShutdownMenuItem();
    updateEndSessionDialog();
    removeUserMenu();

    let userMenu = getUserMenu();
    let item = null;

    item = new PopupMenu.PopupSeparatorMenuItem();
    menu.addMenuItem(item);

    item = new PopupMenu.PopupMenuItem(_("Lock Screen"));
    item.connect('activate', Lang.bind(userMenu, userMenu._onLockScreenActivate));
    menu.addMenuItem(item);

    item = new PopupMenu.PopupMenuItem(_("Switch User"));
    item.connect('activate', Lang.bind(userMenu, userMenu._onLoginScreenActivate));
    menu.addMenuItem(item);

    item = new PopupMenu.PopupMenuItem(_("Log Out..."));
    item.connect('activate', Lang.bind(userMenu, userMenu._onQuitSessionActivate));
    menu.addMenuItem(item);

    item = new PopupMenu.PopupSeparatorMenuItem();
    menu.addMenuItem(item);

    item = new PopupMenu.PopupMenuItem(_("Power Off..."));
    item.connect('activate', Lang.bind(userMenu, userMenu._onSuspendOrPowerOffActivate));
    menu.addMenuItem(item);
}

/**
 * Make the SuspendOrPowerOff shows the label "Power Off".
 */
function updateShutdownMenuItem() {

    getUserMenu()._updateSuspendOrPowerOff = Lang.bind(getUserMenu(), function() {
        if (!this._suspendOrPowerOffItem)
            return;
        this._haveSuspend = false;
        this._suspendOrPowerOffItem.updateText(_("Power Off..."), null);
    });

    getUserMenu()._updateSuspendOrPowerOff();
}

/**
 * Add some more buttons to the EndSession dialog.
 */
function updateEndSessionDialog() {

    const shutdownDialogContent = {
        subject: _("Power Off"),
        inhibitedDescription: _("Click Power Off to quit these applications and power off the system."),
        uninhibitedDescription: _("The system will power off automatically in %d seconds."),
        endDescription: _("Powering off the system."),
        secondaryButtons: [{ signal: 'ConfirmedSuspend',
                           label:  _("Suspend") },
                         { signal: 'ConfirmedHibernate',
                           label:  _("Hibernate") },
                         { signal: 'ConfirmedReboot',
                           label:  _("Restart") }],
        confirmButtons: [{ signal: 'ConfirmedShutdown',
                           label:  _("Power Off") }],
        iconName: 'system-shutdown',
        iconStyleClass: 'end-session-dialog-shutdown-icon'
    };

    EndSessionDialog.DialogContent[1] = shutdownDialogContent;

    EndSessionDialog.EndSessionDialog.prototype._onHibernate = function() {
        this._stopTimer();
        DBus.session.emit_signal('/org/gnome/SessionManager/EndSessionDialog',
                                 'org.gnome.SessionManager.EndSessionDialog',
                                 'Canceled', '', []);
        this.close(global.get_current_time());

        this._screenSaverProxy.LockRemote(Lang.bind(this, function() {
            this._upClient.hibernate_sync(null);
        }));
    };

    EndSessionDialog.EndSessionDialog.prototype._onSuspend = function() {
        this._stopTimer();
        DBus.session.emit_signal('/org/gnome/SessionManager/EndSessionDialog',
                                 'org.gnome.SessionManager.EndSessionDialog',
                                 'Canceled', '', []);
        this.close(global.get_current_time());

        this._screenSaverProxy.LockRemote(Lang.bind(this, function() {
            this._upClient.suspend_sync(null);
        }));
    };

    EndSessionDialog.EndSessionDialog.prototype._updateButtons = function() {
        let dialogContent = EndSessionDialog.DialogContent[this._type];
        let buttons = [];
        this._upClient = getUserMenu()._upClient;
        this._screenSaverProxy = getUserMenu()._screenSaverProxy;

        if ( dialogContent.secondaryButtons ) {
            for (let i = 0; i < dialogContent.secondaryButtons.length; i++) {
                let signal = dialogContent.secondaryButtons[i].signal;
                let label = dialogContent.secondaryButtons[i].label;

                if ( signal == 'ConfirmedHibernate' ) {
                    if ( this._upClient && this._upClient.get_can_hibernate() ) {
                        buttons.push({ action: Lang.bind(this, this._onHibernate),
                                       label: label });
                    }
                }
                else if ( signal == 'ConfirmedSuspend' ) {
                    if ( this._upClient && this._upClient.get_can_suspend() ) {
                        buttons.push({ action: Lang.bind(this, this._onSuspend),
                                       label: label });
                    }
                }
                else {
                    buttons.push({ action: Lang.bind(this, function() {
                                           this._confirm(signal);
                                       }),
                                   label: label });
                }
            }
        }

        buttons.push({ action: Lang.bind(this, this.cancel),
                         label:  _("Cancel"),
                         key:    Clutter.Escape });

        for (let i = 0; i < dialogContent.confirmButtons.length; i++) {
            let signal = dialogContent.confirmButtons[i].signal;
            let label = dialogContent.confirmButtons[i].label;
            buttons.push({ action: Lang.bind(this, function() {
                                       this._confirm(signal);
                                   }),
                           label: label });
        }

        this.setButtons(buttons);
    };
}

/**
 * Remove the UserMenu from the panel but leave the instance because
 * other extensions or methods could be using it, included this one.
 */
function removeUserMenu() {
    Main.panel._rightBox.remove_actor(getUserMenu().actor);
}

function main(meta) {
    
    let localePath = meta.path + '/locale';
    Gettext.bindtextdomain('applications-menu', localePath);
    _f = Gettext.domain('applications-menu').gettext;
    
    Main.panel._leftBox.remove_actor(getActivitiesButton().actor);
    
    let button = new ApplicationsMenuButton(meta.path);
    Main.panel._leftBox.insert_actor(button.actor, 0);
    Main.panel._menus.addMenu(button.menu);
}

function init(meta) {
    main(meta);
}

function enable() {
}

function disable() {
}
