Name:           seerrng
Version:        0.1.0
Release:        1%{?dist}
Summary:        Media request and discovery service
License:        MIT
URL:            https://github.com/snapetech/seerrng
Source0:        seerrng-v%{version}-linux-x64.tar.gz
Source1:        seerrng.service
Source2:        seerrng.env
Source3:        seerrng.sysusers
Source4:        seerrng.tmpfiles
BuildArch:      x86_64
Requires:       nodejs >= 22
%{?systemd_requires}

%{!?_unitdir:%global _unitdir /usr/lib/systemd/system}
%{!?_sysusersdir:%global _sysusersdir /usr/lib/sysusers.d}
%{!?_tmpfilesdir:%global _tmpfilesdir /usr/lib/tmpfiles.d}
%global seerrng_libdir %{_prefix}/lib/seerrng
%{!?systemd_post:%global systemd_post() %{nil}}
%{!?systemd_preun:%global systemd_preun() %{nil}}
%{!?systemd_postun_with_restart:%global systemd_postun_with_restart() %{nil}}
%{!?sysusers_create_compat:%global sysusers_create_compat() %{nil}}
%{!?tmpfiles_create:%global tmpfiles_create() %{nil}}

%description
SeerrNG is a media request and discovery service for Plex, Jellyfin, Emby,
Sonarr, Radarr, Lidarr, and Readarr environments.

%prep
%autosetup -n seerrng-v%{version}-linux-x64

%install
mkdir -p %{buildroot}%{seerrng_libdir} %{buildroot}%{_bindir} %{buildroot}%{_unitdir} \
  %{buildroot}%{_sysusersdir} %{buildroot}%{_tmpfilesdir} %{buildroot}%{_sysconfdir}/seerrng
cp -a . %{buildroot}%{seerrng_libdir}/
ln -s %{seerrng_libdir}/start.sh %{buildroot}%{_bindir}/seerrng
install -m0644 %{SOURCE1} %{buildroot}%{_unitdir}/seerrng.service
install -m0644 %{SOURCE2} %{buildroot}%{_sysconfdir}/seerrng/seerrng.env
install -m0644 %{SOURCE3} %{buildroot}%{_sysusersdir}/seerrng.conf
install -m0644 %{SOURCE4} %{buildroot}%{_tmpfilesdir}/seerrng.conf

%pre
%sysusers_create_compat %{SOURCE3}

%post
%systemd_post seerrng.service
%tmpfiles_create %{_tmpfilesdir}/seerrng.conf

%preun
%systemd_preun seerrng.service

%postun
%systemd_postun_with_restart seerrng.service

%files
%license LICENSE
%{_bindir}/seerrng
%{seerrng_libdir}
%{_unitdir}/seerrng.service
%{_sysusersdir}/seerrng.conf
%{_tmpfilesdir}/seerrng.conf
%config(noreplace) %{_sysconfdir}/seerrng/seerrng.env
